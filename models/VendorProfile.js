const mongoose = require('mongoose');

const vendorProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    storeName: { type: String, required: true, trim: true },
    storeDescription: { type: String, trim: true },
    // The vendor's own store location — compared against a buyer's shipping
    // city/state to pick which delivery fee tier applies. Not a customer address.
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    // Simple 3-tier delivery pricing the vendor sets themselves — no real
    // distance/mapping calculation. 0 is a valid choice (free delivery).
    deliveryFeeSameCity: { type: Number, default: 0 },
    deliveryFeeSameState: { type: Number, default: 0 },
    deliveryFeeDifferentState: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedAt: { type: Date },
    // Stored now for future payout integration; not used until payments are wired up
    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String,
    },
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VendorProfile', vendorProfileSchema);
