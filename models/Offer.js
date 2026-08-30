const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
    proposedPrice: { type: Number, required: true, min: 0 },
    counterPrice: { type: Number, min: 0 },
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
