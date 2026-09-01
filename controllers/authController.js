const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const VendorProfile = require('../models/VendorProfile');
const generateToken = require('../utils/generateToken');
const { sendEmail, wrapEmail } = require('../utils/mailer');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// @desc    Register a new customer
// @route   POST /api/auth/register
// @access  Public
const registerCustomer = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  // password is no longer required at the schema level (Google-signed-in
  // accounts don't have one) — normal registration still requires it, so
  // that has to be validated here instead.
  if (!password || password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('An account with this email already exists');
  }

  const user = await User.create({ name, email, password, phone, role: 'customer' });

  await sendEmail({
    to: user.email,
    subject: 'Welcome to KoboBuy!',
    html: wrapEmail(
      `<p>Hi ${user.name},</p><p>Your KoboBuy account has been created. You can now browse products, negotiate prices, and start shopping.</p>`
    ),
  });

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    token: generateToken(user._id, user.role),
  });
});

// @desc    Register a new vendor (creates User + VendorProfile, status = pending)
// @route   POST /api/auth/register-vendor
// @access  Public
const registerVendor = asyncHandler(async (req, res) => {
  const { name, email, password, phone, storeName, storeDescription } = req.body;

  if (!password || password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('An account with this email already exists');
  }

  if (!storeName) {
    res.status(400);
    throw new Error('Store name is required to register as a vendor');
  }

  const user = await User.create({ name, email, password, phone, role: 'vendor' });

  const vendorProfile = await VendorProfile.create({
    user: user._id,
    storeName,
    storeDescription,
    status: 'pending', // admin must approve before this vendor can list products
  });

  await sendEmail({
    to: user.email,
    subject: 'Welcome to KoboBuy!',
    html: wrapEmail(
      `<p>Hi ${user.name},</p><p>Your KoboBuy vendor account for <strong>${storeName}</strong> has been created. Your store is pending admin approval — we'll let you know once it's live.</p>`
    ),
  });

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    vendorStatus: vendorProfile.status,
    message: 'Vendor account created. Your store is pending admin approval.',
    token: generateToken(user._id, user.role),
  });
});

// @desc    Login (any role)
// @route   POST /api/auth/login
// @access  Public
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // failedLoginAttempts/lockUntil are select:false by default — pull
  // them in explicitly here since this is the one place that needs them.
  const user = await User.findOne({ email }).select('+failedLoginAttempts +lockUntil');

  if (!user) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  // Locked accounts are rejected before even checking the password —
  // this lockout belongs to THIS account only, so it never affects any
  // other user, regardless of shared IP/network.
  if (user.lockUntil && user.lockUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockUntil - new Date()) / 60000);
    res.status(423);
    throw new Error(`Too many failed attempts on this account. Try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`);
  }

  // Google-only accounts have no password to compare against — reject
  // clearly here rather than letting bcrypt.compare crash or silently
  // mismatch on an undefined hash.
  if (!user.password) {
    res.status(400);
    throw new Error('This account uses Google sign-in — use the Google button instead');
  }

  const passwordMatches = await user.matchPassword(password);

  if (!passwordMatches) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      user.failedLoginAttempts = 0; // reset the counter for once the lock expires
    }
    await user.save();
    res.status(401);
    throw new Error('Invalid email or password');
  }

  // Successful login clears any prior failed-attempt history for this account.
  if (user.failedLoginAttempts || user.lockUntil) {
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();
  }

  let vendorStatus;
  if (user.role === 'vendor') {
    const vendorProfile = await VendorProfile.findOne({ user: user._id });
    vendorStatus = vendorProfile ? vendorProfile.status : undefined;
  }

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    ...(vendorStatus && { vendorStatus }),
    token: generateToken(user._id, user.role),
  });
});

// @desc    Sign in (or sign up) with a Google ID token
// @route   POST /api/auth/google
// @access  Public
// Body: { credential } — the ID token from Google's frontend SDK.
const googleAuth = asyncHandler(async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    res.status(400);
    throw new Error('Google credential is required');
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    res.status(401);
    throw new Error('Invalid Google credential');
  }

  // Only the verified payload is ever trusted here — nothing else the
  // frontend might send alongside the credential is used.
  const { email, name, sub: googleId } = payload;
  if (!email) {
    res.status(400);
    throw new Error('Google account has no email');
  }

  let user = await User.findOne({ email });

  if (user) {
    // Already has a password account with this email — link Google to it
    // rather than creating a duplicate.
    if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }
  } else {
    user = await User.create({
      name: name || email.split('@')[0],
      email,
      googleId,
      role: 'customer',
    });
  }

  let vendorStatus;
  if (user.role === 'vendor') {
    const vendorProfile = await VendorProfile.findOne({ user: user._id });
    vendorStatus = vendorProfile ? vendorProfile.status : undefined;
  }

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    ...(vendorStatus && { vendorStatus }),
    token: generateToken(user._id, user.role),
  });
});

// @desc    Get logged-in user's profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  res.json(req.user);
});

// @desc    Request a password reset — emails a reset link if the account exists
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  // Always respond the same way whether or not the account exists —
  // otherwise this endpoint becomes a way to check which emails are
  // registered, which is a real (if minor) privacy leak.
  const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };

  if (!user) {
    return res.json(genericResponse);
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save();

  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your KoboBuy password',
    html: wrapEmail(`
      <p>Hi ${user.name},</p>
      <p>We received a request to reset your KoboBuy password. This link is valid for 1 hour:</p>
      <p><a href="${resetUrl}" style="color:#0F6E56;">Reset your password</a></p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `),
  });

  res.json(genericResponse);
});

// @desc    Reset password using a token from the reset email
// @route   PUT /api/auth/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordToken +resetPasswordExpires');

  if (!user) {
    res.status(400);
    throw new Error('This reset link is invalid or has expired');
  }

  user.password = password; // re-hashed by the pre-save hook
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ message: 'Password reset successfully. You can now log in.' });
});

module.exports = { registerCustomer, registerVendor, loginUser, googleAuth, getMe, forgotPassword, resetPassword };
