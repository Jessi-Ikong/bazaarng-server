const asyncHandler = require('express-async-handler');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Offer = require('../models/Offer');

const CART_POPULATE = {
  path: 'items.product',
  select: 'name price images stock vendor status options',
  populate: { path: 'vendor', select: 'storeName' },
};

// Confirms selectedOptions actually satisfies the product's required
// option groups — one valid value per group, nothing missing.
function validateSelectedOptions(product, selectedOptions = {}) {
  if (!product.options || product.options.length === 0) return;

  const missing = product.options
    .filter((group) => {
      const chosen = selectedOptions[group.name];
      return !chosen || !group.values.includes(chosen);
    })
    .map((group) => group.name);

  if (missing.length > 0) {
    const err = new Error(`Please select: ${missing.join(', ')}`);
    err.statusCode = 400;
    err.code = 'OPTIONS_REQUIRED';
    throw err;
  }
}

// Two cart lines are "the same" only if the product AND every selected
// option value match exactly — different sizes/colors of the same
// product are separate line items, not merged quantities.
function sameSelection(a = {}, b = {}) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]) && aKeys.every((key, i) => key === bKeys[i]);
}

// @desc    Get the logged-in buyer's cart
// @route   GET /api/cart
// @access  Private
const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ buyer: req.user._id }).populate(CART_POPULATE);
  if (!cart) {
    cart = await Cart.create({ buyer: req.user._id, items: [] });
  }
  res.json(cart);
});

// @desc    Add an item to the cart (or increase quantity if the same
//          product + same selected options is already present)
// @route   POST /api/cart/items
// @access  Private
// Body: { productId, quantity, selectedOptions?, offerId? }
const addItemToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1, offerId } = req.body;
  let selectedOptions = req.body.selectedOptions || {};

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.status !== 'active') {
    res.status(400);
    throw new Error('This product is not currently available');
  }
  if (product.stock < quantity) {
    res.status(400);
    throw new Error('Not enough stock available');
  }

  let offer;
  if (offerId) {
    offer = await Offer.findById(offerId);
    if (!offer) {
      res.status(404);
      throw new Error('Offer not found');
    }
    if (String(offer.buyer) !== String(req.user._id)) {
      res.status(403);
      throw new Error('This offer does not belong to you');
    }
    if (String(offer.product) !== String(productId)) {
      res.status(400);
      throw new Error('This offer does not apply to this product');
    }
    if (offer.status !== 'accepted') {
      res.status(400);
      throw new Error(`This offer is ${offer.status}, not accepted`);
    }
    if (offer.expiresAt && offer.expiresAt < new Date()) {
      offer.status = 'expired';
      await offer.save();
      res.status(400);
      throw new Error('This offer has expired');
    }
    // The offer was negotiated for a specific variant — always use THAT
    // exact selection, regardless of whatever selectedOptions this request
    // sends. Otherwise an accepted price could be applied to a different
    // (possibly pricier) variant than the one actually agreed on.
    selectedOptions = offer.selectedOptions || {};
  }

  try {
    validateSelectedOptions(product, selectedOptions);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }

  let priceAtAdd = product.price;

  // A variant-specific price applies when the buyer's exact selection
  // matches a stored combination — but an accepted offer always wins
  // regardless (checked next), since offer pricing must stay unaffected
  // by this feature entirely.
  if (product.variantPrices && product.variantPrices.length > 0) {
    const matchedVariant = product.variantPrices.find((vp) => sameSelection(vp.combination, selectedOptions));
    if (matchedVariant) {
      priceAtAdd = matchedVariant.price;
    }
  }

  if (offer) {
    priceAtAdd = offer.proposedPrice;
  }

  let cart = await Cart.findOne({ buyer: req.user._id });
  if (!cart) {
    cart = await Cart.create({ buyer: req.user._id, items: [] });
  }

  const existingItem = cart.items.find(
    (item) => String(item.product) === String(productId) && sameSelection(item.selectedOptions, selectedOptions)
  );

  if (existingItem) {
    existingItem.quantity += quantity;
    existingItem.priceAtAdd = priceAtAdd; // refresh in case an offer price now applies
  } else {
    cart.items.push({ product: productId, quantity, priceAtAdd, selectedOptions });
  }

  await cart.save();
  await cart.populate(CART_POPULATE);
  res.status(201).json(cart);
});

// @desc    Update quantity of a specific cart line item
// @route   PUT /api/cart/items/:itemId
// @access  Private
// NOTE: addressed by the cart item's own _id, not the product id — a
// product can now appear as more than one line (different variants), so
// product id alone can no longer uniquely identify a line.
const updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) {
    res.status(400);
    throw new Error('Quantity must be at least 1');
  }

  const cart = await Cart.findOne({ buyer: req.user._id });
  if (!cart) {
    res.status(404);
    throw new Error('Cart not found');
  }

  const item = cart.items.id(req.params.itemId);
  if (!item) {
    res.status(404);
    throw new Error('Item not in cart');
  }

  item.quantity = quantity;
  await cart.save();
  await cart.populate(CART_POPULATE);
  res.json(cart);
});

// @desc    Remove a specific cart line item
// @route   DELETE /api/cart/items/:itemId
// @access  Private
const removeCartItem = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ buyer: req.user._id });
  if (!cart) {
    res.status(404);
    throw new Error('Cart not found');
  }

  cart.items = cart.items.filter((i) => String(i._id) !== String(req.params.itemId));
  await cart.save();
  await cart.populate(CART_POPULATE);
  res.json(cart);
});

// @desc    Clear the entire cart
// @route   DELETE /api/cart
// @access  Private
const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ buyer: req.user._id });
  if (cart) {
    cart.items = [];
    await cart.save();
  }
  res.json({ message: 'Cart cleared' });
});

module.exports = { getCart, addItemToCart, updateCartItem, removeCartItem, clearCart };
