const express = require('express');
const router = express.Router();
const { paystackWebhook, verifyPayment } = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

// No auth on the webhook — Paystack calls this directly, verified by signature instead.
router.post('/webhook', paystackWebhook);
router.get('/verify/:reference', protect, verifyPayment);

module.exports = router;
