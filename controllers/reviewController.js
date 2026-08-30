const asyncHandler = require('express-async-handler');
const Review = require('../models/Review');
const Product = require('../models/Product');
const VendorProfile = require('../models/VendorProfile');
const Order = require('../models/Order');

// Recalculate and store a product's average rating + count, and roll it
// up into the vendor's overall rating too.
const recalculateRatings = async (productId, vendorId) => {
  const productReviews = await Review.find({ product: productId });
  const productAvg = productReviews.length
    ? productReviews.reduce((sum, r) => sum + r.rating, 0) / productReviews.length
    : 0;
  await Product.findByIdAndUpdate(productId, {
    ratingAverage: Math.round(productAvg * 10) / 10,
    ratingCount: productReviews.length,
  });

  const vendorReviews = await Review.find({ vendor: vendorId });
  const vendorAvg = vendorReviews.length
    ? vendorReviews.reduce((sum, r) => sum + r.rating, 0) / vendorReviews.length
    : 0;
  await VendorProfile.findByIdAndUpdate(vendorId, {
    ratingAverage: Math.round(vendorAvg * 10) / 10,
    ratingCount: vendorReviews.length,
  });
};

// Shared eligibility check used by both the eligibility endpoint and
// createReview itself, so the two can never drift out of sync with each
// other. Returns { eligible, reason } rather than throwing, so the
// eligibility endpoint can report *why* without it being an error.
async function checkReviewEligibility(buyerId, productId) {
  const alreadyReviewed = await Review.findOne({ product: productId, buyer: buyerId });
  if (alreadyReviewed) {
    return { eligible: false, reason: 'already_reviewed' };
  }

  // Must have a DELIVERED, PAID order containing this product — not just
  // any order. A placed-but-unpaid or still-in-transit order doesn't
  // qualify; this is stricter than the original "any order" check.
  const qualifyingOrder = await Order.findOne({
    buyer: buyerId,
    'items.product': productId,
    paymentStatus: 'paid',
    status: 'delivered',
  });

  if (!qualifyingOrder) {
    return { eligible: false, reason: 'not_delivered' };
  }

  return { eligible: true, reason: null };
}

// @desc    Check whether the logged-in buyer can review this product right
//          now — lets the frontend show/hide the review form correctly
//          instead of guessing or letting them hit a failed submit.
// @route   GET /api/reviews/eligibility/:productId
// @access  Private (customer)
const getReviewEligibility = asyncHandler(async (req, res) => {
  const result = await checkReviewEligibility(req.user._id, req.params.productId);
  res.json(result);
});

// @desc    Create a review — buyer must have a PAID, DELIVERED order
//          containing this product, and not have reviewed it already.
// @route   POST /api/reviews
// @access  Private (customer)
// Body: { productId, rating, comment }
const createReview = asyncHandler(async (req, res) => {
  const { productId, rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    res.status(400);
    throw new Error('Rating must be between 1 and 5');
  }

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  const { eligible, reason } = await checkReviewEligibility(req.user._id, productId);
  if (!eligible) {
    res.status(403);
    throw new Error(
      reason === 'already_reviewed'
        ? 'You have already reviewed this product'
        : 'You can review this product once your order for it has been delivered and paid for'
    );
  }

  const review = await Review.create({
    product: productId,
    vendor: product.vendor,
    buyer: req.user._id,
    rating,
    comment,
  });

  await recalculateRatings(productId, product.vendor);

  res.status(201).json(review);
});

// @desc    Get all reviews for a product
// @route   GET /api/reviews/product/:productId
// @access  Public
const getProductReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ product: req.params.productId })
    .populate('buyer', 'name')
    .sort({ createdAt: -1 });
  res.json(reviews);
});

// @desc    Get all reviews across every product for a given vendor — for
//          display on the vendor's public storefront page.
// @route   GET /api/reviews/vendor/:vendorId
// @access  Public
const getVendorReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ vendor: req.params.vendorId })
    .populate('buyer', 'name')
    .populate('product', 'name images')
    .sort({ createdAt: -1 })
    .limit(50); // a storefront page shows recent reviews, not a full unbounded history
  res.json(reviews);
});

// @desc    Delete own review
// @route   DELETE /api/reviews/:id
// @access  Private (customer, own review only)
const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error('Review not found');
  }
  if (String(review.buyer) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to delete this review');
  }

  const { product, vendor } = review;
  await review.deleteOne();
  await recalculateRatings(product, vendor);

  res.json({ message: 'Review removed' });
});

module.exports = {
  getReviewEligibility,
  createReview,
  getProductReviews,
  getVendorReviews,
  deleteReview,
};
