const express = require('express');
const router = express.Router();
const { updateMyProfile } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.put('/me', protect, updateMyProfile);

module.exports = router;
