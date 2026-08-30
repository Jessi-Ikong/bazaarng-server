const express = require('express');
const router = express.Router();
const {
  getMyVendorProfile,
  updateMyVendorProfile,
  getPublicVendorProfile,
  getPendingVendors,
  getAllVendors,
  updateVendorStatus,
} = require('../controllers/vendorController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.get('/me', protect, authorize('vendor'), getMyVendorProfile);
router.put('/me', protect, authorize('vendor'), updateMyVendorProfile);

router.get('/pending', protect, authorize('admin'), getPendingVendors);
router.get('/all', protect, authorize('admin'), getAllVendors);
router.get('/:id/public', getPublicVendorProfile); // must come before /:id/status — no conflict since suffix differs
router.put('/:id/status', protect, authorize('admin'), updateVendorStatus);

module.exports = router;
