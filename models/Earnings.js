const mongoose = require('mongoose');

// Ledger entry created whenever an order is completed for a vendor.
// Payout logic (actually transferring money) is intentionally separate
// from this record so it can be added later without reshaping this model.
const earningsSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    grossAmount: { type: Number, required: true },
    platformFee: { type: Number, required: true, default: 0 },
    netAmount: { type: Number, required: true },
    payoutStatus: {
      type: String,
      enum: ['unpaid', 'paid'],
      default: 'unpaid',
    },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Earnings', earningsSchema);
