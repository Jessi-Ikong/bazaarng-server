const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String, // snapshot at time of order
    quantity: { type: Number, required: true, min: 1 },
    priceAtPurchase: { type: Number, required: true },
    selectedOptions: { type: Object, default: {} }, // e.g. { Size: 'M', Color: 'Red' }
  },
  { _id: false }
);

// One Order document per vendor per checkout — a single cart checkout
// spanning multiple vendors creates multiple Order documents that share
// a checkoutGroupId so they can still be shown together in order history.
const orderSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
    checkoutGroupId: { type: String, required: true },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'],
      default: 'placed',
    },
    paymentMethod: {
      type: String,
      enum: ['card', 'pay_on_delivery'],
      required: true,
    },
    // Every order is paid through the platform via Paystack — 'pay_on_delivery'
    // just means payment is collected later (once delivered) rather than at
    // checkout. Stock/Earnings are only finalized once paymentStatus is 'paid'.
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid'],
      default: 'unpaid',
    },
    paystackReference: { type: String },
    paidAt: { type: Date },
    // 6-digit code the buyer gives to the vendor/courier at delivery —
    // proof the order actually reached them before it can be marked delivered.
    deliveryConfirmationCode: { type: String },
    deliveredConfirmedAt: { type: Date },
    shippingAddress: {
      street: String,
      city: String,
      state: String,
      country: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
