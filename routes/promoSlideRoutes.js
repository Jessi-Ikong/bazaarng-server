const express = require('express');
const router = express.Router();
const {
  getActivePromoSlides,
  getAllPromoSlidesAdmin,
  createPromoSlide,
  updatePromoSlide,
  deletePromoSlide,
} = require('../controllers/promoSlideController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.get('/', getActivePromoSlides);
router.get('/admin/all', protect, authorize('admin'), getAllPromoSlidesAdmin);
router.post('/', protect, authorize('admin'), createPromoSlide);
router.put('/:id', protect, authorize('admin'), updatePromoSlide);
router.delete('/:id', protect, authorize('admin'), deletePromoSlide);

module.exports = router;
