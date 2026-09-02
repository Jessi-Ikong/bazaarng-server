const mongoose = require('mongoose');

const promoSlideSchema = new mongoose.Schema(
  {
    image: { type: String, required: true },
    title: { type: String, trim: true },
    // Either an internal relative path (e.g. /products/abc123) or a full
    // https:// external URL — the frontend decides which based on the prefix.
    link: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PromoSlide', promoSlideSchema);
