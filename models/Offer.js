const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
    proposedPrice: { type: Number, required: true, min: 0 },
    counterPrice: { type: Number, min: 0 },
    // Which exact variant this offer was negotiated for — e.g. { Storage: '256GB' }.
    // Set once at creation and carried through unchanged; addItemToCart uses
    // this (not whatever the cart request sends) so an accepted price can
    // never be applied to a different, possibly pricier, variant.
    selectedOptions: { type: Object, default: {} },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'countered', 'expired'],
      default: 'pending',
    },
    // Set when status becomes 'accepted' — after this time, the offer
    // is lazily flipped to 'expired' the next time it's read or used.
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Offer', offerSchema);
