const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const VendorProfile = require('../models/VendorProfile');
const User = require('../models/User');
const { initializeTransaction } = require('../utils/paystack');
const { sendEmail, wrapEmail } = require('../utils/mailer');
const { calculateDeliveryFee } = require('../utils/deliveryFee');

function formatNaira(amount) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

// @desc    Checkout the logged-in buyer's cart — splits into one Order per vendor
// @route   POST /api/orders/checkout
// @access  Private (customer)
// Body: { shippingAddress, paymentMethod: 'card' | 'pay_on_delivery' }
//
// Every order is paid through the platform via Paystack — 'pay_on_delivery'
// just defers WHEN that happens (at delivery, not at checkout). For 'card',
// stock and the Earnings ledger entry are deliberately NOT touched here —
// they're finalized in paymentController once Paystack confirms the charge,
// so an abandoned payment never costs a vendor real stock. For
// 'pay_on_delivery', stock is reserved now (the item does ship before
// payment), but Earnings are still deferred until payment actually happens.
const checkout = asyncHandler(async (req, res) => {
  const { shippingAddress, paymentMethod } = req.body;

  if (!shippingAddress || !shippingAddress.street || !shippingAddress.city) {
    res.status(400);
    throw new Error('A shipping address (at least street and city) is required');
  }
  if (!['card', 'pay_on_delivery'].includes(paymentMethod)) {
    res.status(400);
    throw new Error("paymentMethod must be 'card' or 'pay_on_delivery'");
  }

  const cart = await Cart.findOne({ buyer: req.user._id }).populate('items.product');
  if (!cart || cart.items.length === 0) {
    res.status(400);
    throw new Error('Your cart is empty');
  }

  const itemsByVendor = {};
  for (const item of cart.items) {
    const product = item.product;
    if (!product) continue;

    if (product.stock < item.quantity) {
      res.status(400);
      throw new Error(`Not enough stock for "${product.name}" — only ${product.stock} left`);
    }

    const vendorId = String(product.vendor);
    if (!itemsByVendor[vendorId]) itemsByVendor[vendorId] = [];
    itemsByVendor[vendorId].push({
      product: product._id,
      name: product.name,
      quantity: item.quantity,
      priceAtPurchase: item.priceAtAdd,
      selectedOptions: item.selectedOptions || {},
    });
  }

  const checkoutGroupId = crypto.randomUUID();
  const createdOrders = [];
  let grandTotal = 0;

  const vendorProfiles = await VendorProfile.find({ _id: { $in: Object.keys(itemsByVendor) } });
  const vendorProfileById = new Map(vendorProfiles.map((v) => [String(v._id), v]));

  for (const [vendorId, items] of Object.entries(itemsByVendor)) {
    const itemsTotal = items.reduce((sum, i) => sum + i.priceAtPurchase * i.quantity, 0);
    const deliveryFee = calculateDeliveryFee(vendorProfileById.get(vendorId), shippingAddress);
    const totalAmount = itemsTotal + deliveryFee;
    grandTotal += totalAmount;

    const order = await Order.create({
      buyer: req.user._id,
      vendor: vendorId,
      checkoutGroupId,
      items,
      totalAmount,
      deliveryFee,
      shippingAddress,
      status: 'placed',
      paymentMethod,
      paymentStatus: 'unpaid',
      paystackReference: paymentMethod === 'card' ? checkoutGroupId : undefined,
      deliveryConfirmationCode: String(crypto.randomInt(100000, 1000000)),
    });

    if (paymentMethod === 'pay_on_delivery') {
      // Stock is reserved now since the item ships before payment; Earnings
      // are still deferred until the buyer actually pays at delivery.
      for (const item of items) {
        await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
      }
    }
    // For 'card': stock stays untouched until paymentController confirms payment.

    createdOrders.push(order);
  }

  cart.items = [];
  await cart.save();

  if (paymentMethod === 'card') {
    const authorization = await initializeTransaction({
      email: req.user.email,
      amountNaira: grandTotal,
      reference: checkoutGroupId,
      callbackUrl: `${process.env.CLIENT_URL}/payment/callback`,
      metadata: { checkoutGroupId, buyerId: String(req.user._id) },
    });
    return res.status(201).json({
      checkoutGroupId,
      orders: createdOrders,
      authorizationUrl: authorization.authorization_url,
    });
  }

  // pay_on_delivery — the card path's confirmation email waits until
  // paymentController actually confirms the charge; this path is
  // unpaid-but-placed right away, so the buyer should hear about it now.
  // The delivery confirmation code itself is revealed later, in the
  // 'shipped' status-update email — not here.
  await sendEmail({
    to: req.user.email,
    subject: 'Your BazaarNG order has been placed',
    html: wrapEmail(
      `<p>Hi ${req.user.name},</p><p>Your order for ${formatNaira(grandTotal)} has been placed and will ship soon. You'll pay through BazaarNG once it's delivered.</p>`
    ),
  });

  // Vendors previously got no email at all when a new order came in —
  // notify every vendor involved in this checkout so they know to
  // prepare the order, same as pay_on_delivery ships before payment.
  for (const order of createdOrders) {
    const vendorProfile = await VendorProfile.findById(order.vendor).populate('user', 'name email');
    if (vendorProfile?.user) {
      await sendEmail({
        to: vendorProfile.user.email,
        subject: 'New order on BazaarNG',
        html: wrapEmail(
          `<p>Hi ${vendorProfile.user.name},</p><p>You have a new order for ${formatNaira(order.totalAmount)} (${order.items.length} item${order.items.length > 1 ? 's' : ''}) — payment will be collected on delivery. Check your Orders dashboard for details.</p>`
        ),
      });
    }
  }

  res.status(201).json({ checkoutGroupId, orders: createdOrders });
});

// @desc    Buyer initiates payment for a pay-on-delivery order once it's
//          been delivered — still goes through Paystack, just later.
// @route   POST /api/orders/:id/initiate-delivery-payment
// @access  Private (customer, order owner only)
const initiateDeliveryPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  if (String(order.buyer) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to pay for this order');
  }
  if (order.paymentMethod !== 'pay_on_delivery') {
    res.status(400);
    throw new Error('This order is not a pay-on-delivery order');
  }
  if (order.paymentStatus === 'paid') {
    res.status(400);
    throw new Error('This order has already been paid for');
  }
  if (order.status !== 'delivered') {
    res.status(400);
    throw new Error('Payment can only be collected once the order has been delivered');
  }

  const reference = `order_${order._id}_${Date.now()}`;
  order.paystackReference = reference;
  await order.save();

  const authorization = await initializeTransaction({
    email: req.user.email,
    amountNaira: order.totalAmount,
    reference,
    callbackUrl: `${process.env.CLIENT_URL}/payment/callback`,
    metadata: { orderId: String(order._id) },
  });

  res.json({ authorizationUrl: authorization.authorization_url });
});

// @desc    Buyer retries payment for a card order that was abandoned or
//          failed the first time — generates a fresh Paystack reference
//          for just this one order (not the original multi-vendor
//          checkout group, which may include other orders already paid).
// @route   POST /api/orders/:id/retry-payment
// @access  Private (customer, order owner only)
const retryOrderPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  if (String(order.buyer) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to pay for this order');
  }
  if (order.paymentMethod !== 'card') {
    res.status(400);
    throw new Error('This order is not a card payment order');
  }
  if (order.paymentStatus === 'paid') {
    res.status(400);
    throw new Error('This order has already been paid for');
  }

  // A retried order goes back to 'placed' — it may have been auto-marked
  // 'cancelled' by the abandonment sweep above.
  order.status = 'placed';
  const reference = `retry_${order._id}_${Date.now()}`;
  order.paystackReference = reference;
  await order.save();

  const authorization = await initializeTransaction({
    email: req.user.email,
    amountNaira: order.totalAmount,
    reference,
    callbackUrl: `${process.env.CLIENT_URL}/payment/callback`,
    metadata: { orderId: String(order._id) },
  });

  res.json({ authorizationUrl: authorization.authorization_url });
});

const ABANDONED_CARD_ORDER_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

// A card order that's still unpaid an hour after being placed almost
// certainly means the buyer abandoned checkout without ever completing
// (or failing) a real payment attempt — Paystack never fires a webhook
// for that case at all, so nothing else would ever mark it. This is the
// same lazy-expiry pattern already used for offers: checked opportunistically
// whenever the buyer's orders are read, no separate cron job needed.
async function expireAbandonedCardOrders(orders) {
  const cutoff = Date.now() - ABANDONED_CARD_ORDER_TIMEOUT_MS;
  const toExpire = orders.filter(
    (o) =>
      o.paymentMethod === 'card' &&
      o.paymentStatus === 'unpaid' &&
      o.status === 'placed' &&
      new Date(o.createdAt).getTime() < cutoff
  );
  await Promise.all(
    toExpire.map((o) => {
      o.status = 'cancelled';
      return o.save();
    })
  );
}

// @desc    Get the logged-in buyer's order history
// @route   GET /api/orders/mine
// @access  Private (customer)
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ buyer: req.user._id })
    .populate('vendor', 'storeName')
    .populate('items.product', 'images')
    .sort({ createdAt: -1 });
  await expireAbandonedCardOrders(orders);
  res.json(orders);
});

// @desc    Get orders belonging to the logged-in vendor
// @route   GET /api/orders/vendor
// @access  Private/Vendor
const getVendorOrders = asyncHandler(async (req, res) => {
  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  if (!vendorProfile) {
    res.status(404);
    throw new Error('Vendor profile not found');
  }

  const orders = await Order.find({ vendor: vendorProfile._id })
    .populate('buyer', 'name email')
    .sort({ createdAt: -1 });
  res.json(orders);
});

// @desc    Get a single order by id (buyer or the owning vendor only)
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('buyer', 'name email')
    .populate('vendor', 'storeName')
    .populate('items.product', 'images');

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  const isBuyer = String(order.buyer._id) === String(req.user._id);
  const isOwningVendor = vendorProfile && String(order.vendor._id) === String(vendorProfile._id);
  const isAdmin = req.user.role === 'admin';

  if (!isBuyer && !isOwningVendor && !isAdmin) {
    res.status(403);
    throw new Error('Not authorized to view this order');
  }

  res.json(order);
});

// @desc    Generate a downloadable PDF receipt for an order
// @route   GET /api/orders/:id/receipt
// @access  Private (same access as viewing the order: buyer, owning vendor, or admin)
const getOrderReceipt = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('buyer', 'name email')
    .populate('vendor', 'storeName');

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  const isBuyer = String(order.buyer._id) === String(req.user._id);
  const isOwningVendor = vendorProfile && String(order.vendor._id) === String(vendorProfile._id);
  const isAdmin = req.user.role === 'admin';

  if (!isBuyer && !isOwningVendor && !isAdmin) {
    res.status(403);
    throw new Error('Not authorized to view this order');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=bazaarng-receipt-${order._id.toString().slice(-8)}.pdf`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).fillColor('#04342C').text('BazaarNG', { continued: true }).fillColor('#1D9E75').text('');
  doc.moveDown(0.3);
  doc.fontSize(14).fillColor('#1A1A1A').text('Order Receipt');
  doc.fontSize(9).fillColor('#6B6B66').text(`Order #${order._id.toString().slice(-8).toUpperCase()}`);
  doc.text(`Placed: ${new Date(order.createdAt).toLocaleString('en-NG')}`);
  doc.moveDown();

  doc.strokeColor('#E8E7E1').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown();

  doc.fontSize(11).fillColor('#1A1A1A').text('Items', { underline: true });
  doc.moveDown(0.5);
  order.items.forEach((item) => {
    const optionsText = Object.entries(item.selectedOptions || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    doc.fontSize(10).fillColor('#1A1A1A').text(item.name);
    if (optionsText) doc.fontSize(8).fillColor('#6B6B66').text(optionsText);
    doc
      .fontSize(9)
      .fillColor('#6B6B66')
      .text(`${formatNaira(item.priceAtPurchase)} × ${item.quantity} = ${formatNaira(item.priceAtPurchase * item.quantity)}`);
    doc.moveDown(0.5);
  });

  doc.strokeColor('#E8E7E1').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown();

  doc.fontSize(10).fillColor('#6B6B66').text(`Delivery fee: ${formatNaira(order.deliveryFee || 0)}`, { align: 'right' });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor('#04342C').text(`Total: ${formatNaira(order.totalAmount)}`, { align: 'right' });
  doc.moveDown();

  doc.fontSize(11).fillColor('#1A1A1A').text('Payment', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#6B6B66');
  doc.text(`Method: ${order.paymentMethod === 'card' ? 'Card (Paystack)' : 'Pay on delivery'}`);
  doc.text(`Status: ${order.paymentStatus}`);
  if (order.paidAt) doc.text(`Paid on: ${new Date(order.paidAt).toLocaleString('en-NG')}`);
  if (order.paystackReference) doc.text(`Reference: ${order.paystackReference}`);
  doc.moveDown();

  doc.fontSize(11).fillColor('#1A1A1A').text('Shipping', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#6B6B66');
  const addr = order.shippingAddress || {};
  doc.text([addr.street, addr.city, addr.state, addr.country].filter(Boolean).join(', '));
  doc.moveDown();

  doc.fontSize(9).fillColor('#6B6B66');
  doc.text(`Buyer: ${order.buyer?.name} (${order.buyer?.email})`);
  doc.text(`Sold by: ${order.vendor?.storeName}`);

  doc.end();
});

// @desc    Vendor updates an order's status
// @route   PUT /api/orders/:id/status
// @access  Private/Vendor
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, deliveryCode } = req.body;
  const validStatuses = ['confirmed', 'shipped', 'delivered', 'cancelled'];

  if (!validStatuses.includes(status)) {
    res.status(400);
    throw new Error(`Status must be one of: ${validStatuses.join(', ')}`);
  }

  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  if (!vendorProfile || String(order.vendor) !== String(vendorProfile._id)) {
    res.status(403);
    throw new Error('Not authorized to update this order');
  }

  // Proof of delivery: the vendor/courier must have the code the buyer was
  // emailed at checkout/payment before this order can flip to 'delivered'.
  // Every other transition is unaffected.
  if (status === 'delivered') {
    const submittedCode = String(deliveryCode || '').trim();
    if (!submittedCode || submittedCode !== String(order.deliveryConfirmationCode || '').trim()) {
      res.status(400);
      throw new Error('Incorrect delivery code');
    }
    order.deliveredConfirmedAt = new Date();
  }

  order.status = status;
  const updated = await order.save();

  const buyer = await User.findById(order.buyer);
  if (buyer) {
    if (status === 'delivered') {
      const itemLinks = order.items
        .map((i) => `<li><a href="${process.env.CLIENT_URL}/products/${i.product}">${i.name}</a></li>`)
        .join('');
      await sendEmail({
        to: buyer.email,
        subject: 'Delivery confirmed — how was it?',
        html: wrapEmail(
          `<p>Hi ${buyer.name},</p><p>Your order has been marked as delivered. We'd love to hear what you think!</p><p>Leave a review:</p><ul>${itemLinks}</ul>`
        ),
      });
    } else {
      const statusMessages = {
        confirmed: 'Your order has been confirmed by the vendor.',
        shipped: `Your order is on its way! Give this code to the vendor/courier when it's delivered: ${order.deliveryConfirmationCode}`,
        cancelled: 'Your order was cancelled by the vendor.',
      };
      await sendEmail({
        to: buyer.email,
        subject: `Order update: ${status}`,
        html: wrapEmail(`<p>Hi ${buyer.name},</p><p>${statusMessages[status]}</p>`),
      });
    }
  }

  res.json(updated);
});

// @desc    Get every order on the platform (admin oversight)
// @route   GET /api/orders/admin/all
// @access  Private/Admin
const getAllOrdersAdmin = asyncHandler(async (req, res) => {
  const orders = await Order.find({})
    .populate('buyer', 'name email')
    .populate('vendor', 'storeName')
    .sort({ createdAt: -1 });
  res.json(orders);
});

module.exports = {
  checkout,
  initiateDeliveryPayment,
  retryOrderPayment,
  getMyOrders,
  getVendorOrders,
  getOrderById,
  getOrderReceipt,
  updateOrderStatus,
  getAllOrdersAdmin,
};
