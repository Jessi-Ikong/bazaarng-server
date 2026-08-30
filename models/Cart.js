const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  // Snapshot of the price the item was added at (offer-accepted price, if applicable)
  priceAtAdd: { type: Number, required: true },
  // Which value was picked per option group, e.g. { Size: 'M', Color: 'Red' }.
  // Two different selections of the same product are separate line items —
  // that's why cart items need their own _id below (previously { _id: false }),
  // since matching by product id alone can no longer uniquely identify a line.
  selectedOptions: { type: Object, default: {} },
});

const cartSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: [cartItemSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
