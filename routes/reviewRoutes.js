const express = require('express');
const router = express.Router();
const {
  getReviewEligibility,
  createReview,
  getProductReviews,
  getVendorReviews,
  deleteReview,
} = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { reviewLimiter } = require('../middleware/rateLimitMiddleware');

router.get('/product/:productId', getProductReviews);
router.get('/vendor/:vendorId', getVendorReviews);
router.get('/eligibility/:productId', protect, authorize('customer'), getReviewEligibility);
router.post('/', protect, authorize('customer'), reviewLimiter, createReview);
router.delete('/:id', protect, authorize('customer'), deleteReview);

module.exports = router;
