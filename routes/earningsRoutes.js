const express = require('express');
const router = express.Router();
const { getVendorEarnings } = require('../controllers/earningsController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.get('/vendor', protect, authorize('vendor'), getVendorEarnings);

module.exports = router;
