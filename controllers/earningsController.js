const asyncHandler = require('express-async-handler');
const Earnings = require('../models/Earnings');
const VendorProfile = require('../models/VendorProfile');

// @desc    Get the logged-in vendor's earnings ledger + summary totals
// @route   GET /api/earnings/vendor
// @access  Private/Vendor
const getVendorEarnings = asyncHandler(async (req, res) => {
  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  if (!vendorProfile) {
    res.status(404);
    throw new Error('Vendor profile not found');
  }

  const entries = await Earnings.find({ vendor: vendorProfile._id })
    .populate('order', 'checkoutGroupId status createdAt')
    .sort({ createdAt: -1 });

  const summary = entries.reduce(
    (acc, e) => {
      acc.totalGross += e.grossAmount;
      acc.totalFees += e.platformFee;
      acc.totalNet += e.netAmount;
      if (e.payoutStatus === 'unpaid') acc.unpaidNet += e.netAmount;
      return acc;
    },
    { totalGross: 0, totalFees: 0, totalNet: 0, unpaidNet: 0 }
  );

  res.json({ entries, summary });
});

module.exports = { getVendorEarnings };
