const rateLimit = require('express-rate-limit');

// This is now a coarse secondary guard against outright flooding (e.g.
// one source hammering many different accounts rapidly) — the real
// per-account defense against a single account being brute-forced lives
// in authController's failedLoginAttempts/lockUntil logic instead, since
// an IP-only limit can't distinguish "one attacker" from "several real
// users sharing a network," which is exactly what caused one user's
// lockout to also block an unrelated account earlier.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: { message: 'Too many login attempts from this network. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration is looser (real users retry typos) but still capped
// against bot signup floods.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15,
  message: { message: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Forgot-password is the endpoint most vulnerable to being used as a spam
// vector (repeatedly triggering reset emails to someone else's inbox).
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Checkout is a payment endpoint — the strictest limiter here, guarding
// against card-testing fraud (scripted, repeated small checkout attempts
// used to validate stolen card numbers).
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many checkout attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Offers are a normal part of browsing/negotiating, so this is looser than
// checkout — just enough to stop a scripted flood of spam offers at a vendor.
const offerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many offers submitted. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reviews are already gated at the database level (real paid+delivered
// order required, one review per product per buyer) — this is mostly
// about avoiding wasted server load from repeated invalid attempts.
const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many review submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  checkoutLimiter,
  offerLimiter,
  reviewLimiter,
};
