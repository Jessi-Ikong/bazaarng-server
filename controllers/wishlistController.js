const asyncHandler = require('express-async-handler');
const Wishlist = require('../models/Wishlist');

// @desc    Get the logged-in user's wishlist
// @route   GET /api/wishlist
// @access  Private
const getWishlist = asyncHandler(async (req, res) => {
  let wishlist = await Wishlist.findOne({ user: req.user._id }).populate({
    path: 'products',
    select: 'name price images vendor status ratingAverage ratingCount offersEnabled',
    populate: { path: 'vendor', select: 'storeName' },
  });

  if (!wishlist) {
    wishlist = await Wishlist.create({ user: req.user._id, products: [] });
  }

  res.json(wishlist);
});

// @desc    Add a product to the wishlist
// @route   POST /api/wishlist/:productId
// @access  Private
const addToWishlist = asyncHandler(async (req, res) => {
  let wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist) {
    wishlist = await Wishlist.create({ user: req.user._id, products: [] });
  }

  const alreadyIn = wishlist.products.some((p) => String(p) === req.params.productId);
  if (!alreadyIn) {
    wishlist.products.push(req.params.productId);
    await wishlist.save();
  }

  await wishlist.populate({
    path: 'products',
    select: 'name price images vendor status ratingAverage ratingCount offersEnabled',
    populate: { path: 'vendor', select: 'storeName' },
  });
  res.status(201).json(wishlist);
});

// @desc    Remove a product from the wishlist
// @route   DELETE /api/wishlist/:productId
// @access  Private
const removeFromWishlist = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist) {
    res.status(404);
    throw new Error('Wishlist not found');
  }

  wishlist.products = wishlist.products.filter((p) => String(p) !== req.params.productId);
  await wishlist.save();
  await wishlist.populate({
    path: 'products',
    select: 'name price images vendor status ratingAverage ratingCount offersEnabled',
    populate: { path: 'vendor', select: 'storeName' },
  });
  res.json(wishlist);
});

module.exports = { getWishlist, addToWishlist, removeFromWishlist };
