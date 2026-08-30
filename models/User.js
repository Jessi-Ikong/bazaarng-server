const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, trim: true },
    role: {
      type: String,
      enum: ['customer', 'vendor', 'admin'],
      default: 'customer',
    },
    shippingAddress: {
      street: String,
      city: String,
      state: String,
      country: String,
    },
    // Stores a HASHED reset token (never the raw one) plus its expiry.
    // The raw token only ever exists in the emailed link, never in the DB.
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    // Failed-login lockout is tracked PER ACCOUNT here, not per IP. An
    // IP-based limiter (still used as a coarser flood guard) can't tell
    // "one attacker guessing this account's password" apart from "two
    // different real people who happen to share a network" — locking by
    // account instead means one person's failed logins never affect
    // anyone else's.
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
  },
  { timestamps: true }
);

// Hash password before saving, only if it was modified
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Instance method to compare entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
