const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    // Simple selectable variant tags — e.g. [{ name: 'Size', values: ['S','M','L','XL'] }].
    // Deliberately NOT per-variant stock/pricing: stock stays one shared
    // number for the whole product regardless of which option is picked.
    options: [
      {
        name: { type: String, required: true, trim: true },
        values: [{ type: String, trim: true }],
      },
    ],
    // Optional per-variant price overrides — e.g. { combination: { Size: 'L' },
    // price: 65000 } charges 65000 for that exact combination instead of the
    // base price. Stock is NOT tracked per-variant, only price.
    variantPrices: [
      {
        combination: { type: Object, required: true },
        price: { type: Number, required: true, min: 0 },
      },
    ],
    images: [{ type: String }],
    stock: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['active', 'out_of_stock', 'disabled'],
      default: 'active',
    },
    offersEnabled: { type: Boolean, default: true },
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);
