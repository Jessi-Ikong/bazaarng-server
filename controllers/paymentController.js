const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Earnings = require('../models/Earnings');
const User = require('../models/User');
const VendorProfile = require('../models/VendorProfile');
const { verifyTransaction } = require('../utils/paystack');
const { PLATFORM_FEE_RATE } = require('../utils/constants');
const { sendEmail, wrapEmail } = require('../utils/mailer');

function formatNaira(amount) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

// Marks every unpaid order tied to this Paystack reference as paid, then
// finalizes the side effects that were deliberately deferred until real
// payment: stock decrement (for card orders — pay_on_delivery orders
// already decremented stock at order creation) and the Earnings ledger
// entry. Safe to call more than once — both the webhook and the manual
// verify-on-callback path can trigger this, so every step checks whether
// it already happened before repeating it.
async function finalizeOrdersForReference(reference) {
  const orders = await Order.find({ paystackReference: reference, paymentStatus: 'unpaid' });
  if (orders.length === 0) return [];

  for (const order of orders) {
    order.paymentStatus = 'paid';
    order.paidAt = new Date();
    await order.save();

    if (order.paymentMethod === 'card') {
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
      }
    }

    const existingEarning = await Earnings.findOne({ order: order._id });
    if (!existingEarning) {
      const platformFee = Math.round(order.totalAmount * PLATFORM_FEE_RATE);
      await Earnings.create({
        vendor: order.vendor,
        order: order._id,
        grossAmount: order.totalAmount,
        platformFee,
        netAmount: order.totalAmount - platformFee,
        payoutStatus: 'unpaid',
      });
    }

    const buyer = await User.findById(order.buyer);
    if (buyer) {
      await sendEmail({
        to: buyer.email,
        subject: 'Payment received — KoboBuy order confirmed',
        html: wrapEmail(
          `<p>Hi ${buyer.name},</p><p>We've received payment of ${formatNaira(order.totalAmount)} for your order. It's now confirmed.</p><p>Give this code to the vendor/courier when your order is delivered: <strong>${order.deliveryConfirmationCode}</strong></p>`
        ),
      });
    }

    // Card orders don't notify the vendor at checkout (payment isn't
    // certain yet at that point) — this is the moment a card order
    // becomes real to them, so this is when they should first hear about it.
    const vendorProfile = await VendorProfile.findById(order.vendor).populate('user', 'name email');
    if (vendorProfile?.user) {
      await sendEmail({
        to: vendorProfile.user.email,
        subject: 'New paid order on KoboBuy',
        html: wrapEmail(
          `<p>Hi ${vendorProfile.user.name},</p><p>You have a new paid order for ${formatNaira(order.totalAmount)} (${order.items.length} item${order.items.length > 1 ? 's' : ''}). Check your Orders dashboard for details.</p>`
        ),
      });
    }
  }

  return orders;
}

// @desc    Paystack webhook — the source of truth for payment confirmation
// @route   POST /api/payments/webhook
// @access  Public (verified via signature, not auth)
// NOTE: this route is mounted with express.raw() in server.js, not
// express.json(), so req.body is the raw Buffer needed for signature
// verification. Do not parse it as JSON before this check.
const paystackWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const expectedHash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');

  if (signature !== expectedHash) {
    res.status(401);
    throw new Error('Invalid Paystack signature');
  }

  const event = JSON.parse(req.body.toString('utf8'));
  if (event.event === 'charge.success') {
    await finalizeOrdersForReference(event.data.reference);
  }

  res.sendStatus(200);
});

// @desc    Manually verify a transaction — called by the frontend right
//          after Paystack redirects back, so the buyer gets an immediate
//          result instead of waiting on the webhook to arrive.
// @route   GET /api/payments/verify/:reference
// @access  Private
const verifyPayment = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const result = await verifyTransaction(reference);

  if (result.status === 'success') {
    await finalizeOrdersForReference(reference);
    return res.json({ paid: true });
  }

  res.json({ paid: false, status: result.status });
});

module.exports = { paystackWebhook, verifyPayment, finalizeOrdersForReference };
