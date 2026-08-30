const asyncHandler = require('express-async-handler');
const User = require('../models/User');

// @desc    Update the logged-in user's own profile (name, phone, shipping address)
// @route   PUT /api/users/me
// @access  Private
const updateMyProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  if (req.body.name) user.name = req.body.name;
  if (req.body.phone !== undefined) user.phone = req.body.phone;
  if (req.body.shippingAddress) {
    user.shippingAddress = { ...user.shippingAddress, ...req.body.shippingAddress };
  }

  const updated = await user.save();
  res.json({
    _id: updated._id,
    name: updated.name,
    email: updated.email,
    phone: updated.phone,
    role: updated.role,
    shippingAddress: updated.shippingAddress,
  });
});

module.exports = { updateMyProfile };
