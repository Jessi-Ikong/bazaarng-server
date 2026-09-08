const express = require('express');
const router = express.Router();
const {
  createOffer,
  getMyOffers,
  getVendorOffers,
  respondToOffer,
  acceptCounterOffer,
} = require('../controllers/offerController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { offerLimiter } = require('../middleware/rateLimitMiddleware');

router.post('/', protect, authorize('customer'), offerLimiter, createOffer);
router.get('/mine', protect, authorize('customer'), getMyOffers);
router.get('/vendor', protect, authorize('vendor'), getVendorOffers);
router.put('/:id/respond', protect, authorize('vendor'), respondToOffer);
router.put('/:id/accept-counter', protect, authorize('customer'), acceptCounterOffer);

module.exports = router;
