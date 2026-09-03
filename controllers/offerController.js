const asyncHandler = require('express-async-handler');
const Offer = require('../models/Offer');
const Product = require('../models/Product');
const VendorProfile = require('../models/VendorProfile');
const User = require('../models/User');
const { sendEmail, wrapEmail } = require('../utils/mailer');

function formatNaira(amount) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

// Same pattern as cartController.js's addItemToCart — confirms
// selectedOptions actually satisfies the product's required option groups.
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
    throw err;
  }
}

// Same matching rule cartController.js uses against variantPrices — every
// selected key/value must match exactly.
function sameSelection(a = {}, b = {}) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]) && aKeys.every((key, i) => key === bKeys[i]);
}

const OFFER_VALIDITY_HOURS = 6;

// Lazily flips any accepted offer past its expiry into 'expired'. Called
// before returning offers to the client, rather than via a background
// job — simple and sufficient at this scale, since nothing "un-expires."
async function expireStaleOffers(offers) {
  const now = new Date();
  const toExpire = offers.filter(
    (o) => o.status === 'accepted' && o.expiresAt && o.expiresAt < now
  );
  await Promise.all(
    toExpire.map((o) => {
      o.status = 'expired';
      return o.save();
    })
  );
  return offers;
}

// @desc    Submit an offer on a product
// @route   POST /api/offers
// @access  Private (customer)
const createOffer = asyncHandler(async (req, res) => {
  const { productId, proposedPrice, selectedOptions = {} } = req.body;

  if (!proposedPrice || proposedPrice <= 0) {
    res.status(400);
    throw new Error('proposedPrice must be greater than 0');
  }

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (!product.offersEnabled) {
    res.status(400);
    throw new Error('This vendor does not accept offers on this product');
  }

  try {
    validateSelectedOptions(product, selectedOptions);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }

  // The ceiling an offer must stay below is whichever price actually
  // applies to THIS exact variant — its own override if one is set,
  // otherwise the base listed price. Validating against the base price
  // alone would let a buyer negotiate against a cheap variant and then
  // apply that discount to a pricier one at checkout.
  let listedPrice = product.price;
  if (product.variantPrices && product.variantPrices.length > 0) {
    const matchedVariant = product.variantPrices.find((vp) => sameSelection(vp.combination, selectedOptions));
    if (matchedVariant) {
      listedPrice = matchedVariant.price;
    }
  }

  if (proposedPrice >= listedPrice) {
    res.status(400);
    throw new Error(`Your offer should be below the listed price of ${formatNaira(listedPrice)}.`);
  }

  const offer = await Offer.create({
    product: productId,
    buyer: req.user._id,
    vendor: product.vendor,
    proposedPrice,
    selectedOptions,
    status: 'pending',
  });

  res.status(201).json(offer);
});

// @desc    Get the logged-in buyer's own offers
// @route   GET /api/offers/mine
// @access  Private (customer)
const getMyOffers = asyncHandler(async (req, res) => {
  const offers = await Offer.find({ buyer: req.user._id })
    .populate('product', 'name images price offersEnabled')
    .sort({ createdAt: -1 });
  await expireStaleOffers(offers);
  res.json(offers);
});

// @desc    Get offers made on the logged-in vendor's products
// @route   GET /api/offers/vendor
// @access  Private/Vendor
const getVendorOffers = asyncHandler(async (req, res) => {
  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  if (!vendorProfile) {
    res.status(404);
    throw new Error('Vendor profile not found');
  }

  const offers = await Offer.find({ vendor: vendorProfile._id })
    .populate('product', 'name images price')
    .populate('buyer', 'name email')
    .sort({ createdAt: -1 });
  await expireStaleOffers(offers);
  res.json(offers);
});

// @desc    Vendor responds to an offer: accept, reject, or counter
// @route   PUT /api/offers/:id/respond
// @access  Private/Vendor
// Body: { action: 'accept' | 'reject' | 'counter', counterPrice? }
const respondToOffer = asyncHandler(async (req, res) => {
  const { action, counterPrice } = req.body;

  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  const offer = await Offer.findById(req.params.id);

  if (!offer) {
    res.status(404);
    throw new Error('Offer not found');
  }
  if (!vendorProfile || String(offer.vendor) !== String(vendorProfile._id)) {
    res.status(403);
    throw new Error('Not authorized to respond to this offer');
  }
  if (offer.status !== 'pending') {
    res.status(400);
    throw new Error(`Offer has already been ${offer.status}`);
  }

  if (action === 'accept') {
    offer.status = 'accepted';
    offer.expiresAt = new Date(Date.now() + OFFER_VALIDITY_HOURS * 60 * 60 * 1000);
  } else if (action === 'reject') {
    offer.status = 'rejected';
  } else if (action === 'counter') {
    if (!counterPrice || counterPrice <= 0) {
      res.status(400);
      throw new Error('counterPrice is required to counter an offer');
    }
    offer.status = 'countered';
    offer.counterPrice = counterPrice;
  } else {
    res.status(400);
    throw new Error("action must be 'accept', 'reject', or 'counter'");
  }

  const updated = await offer.save();

  // Notify the buyer of the outcome — this is the whole point of the
  // notification: without it, buyers have to keep manually re-checking
  // My Offers to find out what happened.
  const buyer = await User.findById(offer.buyer);
  const product = await Product.findById(offer.product);
  if (buyer && product) {
    let subject, message;
    if (action === 'accept') {
      subject = 'Your offer was accepted!';
      message = `Your offer of ${formatNaira(offer.proposedPrice)} on <strong>${product.name}</strong> was accepted. You have 6 hours to add it to your cart at this price.`;
    } else if (action === 'reject') {
      subject = 'Your offer was declined';
      message = `Your offer of ${formatNaira(offer.proposedPrice)} on <strong>${product.name}</strong> was declined by the vendor.`;
    } else {
      subject = 'The vendor countered your offer';
      message = `The vendor countered your offer on <strong>${product.name}</strong> with ${formatNaira(counterPrice)}. Visit My Offers to accept or let it stand.`;
    }
    await sendEmail({
      to: buyer.email,
      subject,
      html: wrapEmail(`<p>Hi ${buyer.name},</p><p>${message}</p>`),
    });
  }

  res.json(updated);
});

// @desc    Buyer accepts a vendor's counter-offer
// @route   PUT /api/offers/:id/accept-counter
// @access  Private (customer)
const acceptCounterOffer = asyncHandler(async (req, res) => {
  const offer = await Offer.findById(req.params.id);

  if (!offer) {
    res.status(404);
    throw new Error('Offer not found');
  }
  if (String(offer.buyer) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to respond to this offer');
  }
  if (offer.status !== 'countered') {
    res.status(400);
    throw new Error('This offer is not in a countered state');
  }

  offer.status = 'accepted';
  offer.proposedPrice = offer.counterPrice; // the agreed price is now the counter price
  offer.expiresAt = new Date(Date.now() + OFFER_VALIDITY_HOURS * 60 * 60 * 1000);
  const updated = await offer.save();

  const vendorProfile = await VendorProfile.findById(offer.vendor).populate('user', 'name email');
  const product = await Product.findById(offer.product);
  if (vendorProfile?.user && product) {
    await sendEmail({
      to: vendorProfile.user.email,
      subject: 'Your counter-offer was accepted',
      html: wrapEmail(
        `<p>Hi ${vendorProfile.user.name},</p><p>The buyer accepted your counter-offer of ${formatNaira(offer.proposedPrice)} on <strong>${product.name}</strong>. They have 6 hours to complete checkout at this price.</p>`
      ),
    });
  }

  res.json(updated);
});

module.exports = { createOffer, getMyOffers, getVendorOffers, respondToOffer, acceptCounterOffer };
