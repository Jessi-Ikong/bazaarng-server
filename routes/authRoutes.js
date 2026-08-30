const express = require('express');
const router = express.Router();
const {
  registerCustomer,
  registerVendor,
  loginUser,
  getMe,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { loginLimiter, registerLimiter, forgotPasswordLimiter } = require('../middleware/rateLimitMiddleware');

router.post('/register', registerLimiter, registerCustomer);
router.post('/register-vendor', registerLimiter, registerVendor);
router.post('/login', loginLimiter, loginUser);
router.get('/me', protect, getMe);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.put('/reset-password/:token', resetPassword);

module.exports = router;
