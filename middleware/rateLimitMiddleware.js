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

module.exports = { loginLimiter, registerLimiter, forgotPasswordLimiter };
