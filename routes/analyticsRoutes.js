const express = require('express');
const router = express.Router();
const { getVendorAnalytics, getAdminAnalytics } = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.get('/vendor', protect, authorize('vendor'), getVendorAnalytics);
router.get('/admin', protect, authorize('admin'), getAdminAnalytics);

module.exports = router;
