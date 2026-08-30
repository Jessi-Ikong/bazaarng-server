const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    parentCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    // Stores a Tabler icon class name (e.g. "ti-devices") picked by admin
    // when creating the category. Falls back to a generic icon on the
    // frontend if unset.
    icon: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema);
