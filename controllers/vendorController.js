const asyncHandler = require('express-async-handler');
const VendorProfile = require('../models/VendorProfile');
const Product = require('../models/Product');
const { sendEmail, wrapEmail } = require('../utils/mailer');

// @desc    Public vendor storefront — store info + their active products.
//          Only approved vendors are visible here; a pending/rejected
//          vendor has no public page yet.
// @route   GET /api/vendors/:id/public
// @access  Public
const getPublicVendorProfile = asyncHandler(async (req, res) => {
  const profile = await VendorProfile.findById(req.params.id).select(
    'storeName storeDescription ratingAverage ratingCount status approvedAt'
  );

  if (!profile || profile.status !== 'approved') {
    res.status(404);
    throw new Error('Store not found');
  }

  const products = await Product.find({ vendor: profile._id, status: 'active' })
    .select('name price images ratingAverage ratingCount offersEnabled')
    .sort({ createdAt: -1 });

  res.json({ profile, products });
});

// @desc    Get logged-in vendor's own profile
// @route   GET /api/vendors/me
// @access  Private/Vendor
const getMyVendorProfile = asyncHandler(async (req, res) => {
  const profile = await VendorProfile.findOne({ user: req.user._id });
  if (!profile) {
    res.status(404);
    throw new Error('Vendor profile not found');
  }
  res.json(profile);
});

// @desc    Update logged-in vendor's own store info
// @route   PUT /api/vendors/me
// @access  Private/Vendor
const updateMyVendorProfile = asyncHandler(async (req, res) => {
  const profile = await VendorProfile.findOne({ user: req.user._id });
  if (!profile) {
    res.status(404);
    throw new Error('Vendor profile not found');
  }

  profile.storeName = req.body.storeName || profile.storeName;
  profile.storeDescription = req.body.storeDescription || profile.storeDescription;
  if (req.body.bankDetails) {
    profile.bankDetails = { ...profile.bankDetails, ...req.body.bankDetails };
  }

  const updated = await profile.save();
  res.json(updated);
});

// @desc    List vendors pending approval
// @route   GET /api/vendors/pending
// @access  Private/Admin
const getPendingVendors = asyncHandler(async (req, res) => {
  const pending = await VendorProfile.find({ status: 'pending' }).populate('user', 'name email phone');
  res.json(pending);
});

// @desc    List all vendors, any status (for admin oversight)
// @route   GET /api/vendors/all
// @access  Private/Admin
const getAllVendors = asyncHandler(async (req, res) => {
  const vendors = await VendorProfile.find({})
    .populate('user', 'name email phone')
    .sort({ createdAt: -1 });
  res.json(vendors);
});

// @desc    Approve or reject a vendor
// @route   PUT /api/vendors/:id/status
// @access  Private/Admin
const updateVendorStatus = asyncHandler(async (req, res) => {
  const { status } = req.body; // 'approved' or 'rejected'

  if (!['approved', 'rejected'].includes(status)) {
    res.status(400);
    throw new Error("Status must be 'approved' or 'rejected'");
  }

  const profile = await VendorProfile.findById(req.params.id).populate('user', 'name email');
  if (!profile) {
    res.status(404);
    throw new Error('Vendor not found');
  }

  profile.status = status;
  if (status === 'approved') profile.approvedAt = new Date();

  const updated = await profile.save();

  if (profile.user) {
    const subject = status === 'approved' ? 'Your KoboBuy store is approved!' : 'Your KoboBuy vendor application';
    const message =
      status === 'approved'
        ? `Great news — <strong>${profile.storeName}</strong> has been approved. You can now start listing products.`
        : `Your application for <strong>${profile.storeName}</strong> was not approved at this time.`;
    await sendEmail({
      to: profile.user.email,
      subject,
      html: wrapEmail(`<p>Hi ${profile.user.name},</p><p>${message}</p>`),
    });
  }

  res.json(updated);
});

module.exports = {
  getMyVendorProfile,
  updateMyVendorProfile,
  getPublicVendorProfile,
  getPendingVendors,
  getAllVendors,
  updateVendorStatus,
};
