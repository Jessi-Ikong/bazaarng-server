const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const VendorProfile = require('../models/VendorProfile');
const cloudinary = require('../utils/cloudinary');

// Escapes regex special characters in user input so search terms like
// "iPhone 13 (128GB)" can't break or hijack the regex we build from them.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Helper: get the requesting user's VendorProfile, and confirm they're approved
const getApprovedVendorProfile = async (userId) => {
  const profile = await VendorProfile.findOne({ user: userId });
  if (!profile) {
    const err = new Error('Vendor profile not found');
    err.statusCode = 404;
    throw err;
  }
  if (profile.status !== 'approved') {
    const err = new Error(
      `Your vendor account is ${profile.status} — you must be approved by an admin before listing products`
    );
    err.statusCode = 403;
    throw err;
  }
  return profile;
};

// Validates the shape of vendor-supplied option groups — each needs a
// name and at least one non-empty value. Returns a cleaned array (or []).
function validateOptions(options) {
  if (!options) return [];
  if (!Array.isArray(options)) {
    const err = new Error('options must be an array');
    err.statusCode = 400;
    throw err;
  }
  return options.map((group) => {
    const name = (group.name || '').trim();
    const values = (group.values || []).map((v) => String(v).trim()).filter(Boolean);
    if (!name || values.length === 0) {
      const err = new Error('Each option group needs a name and at least one value');
      err.statusCode = 400;
      throw err;
    }
    return { name, values };
  });
}

// @desc    Create a product (approved vendors only)
// @route   POST /api/products
// @access  Private/Vendor
const createProduct = asyncHandler(async (req, res) => {
  const vendorProfile = await getApprovedVendorProfile(req.user._id).catch((err) => {
    res.status(err.statusCode || 400);
    throw err;
  });

  const { name, description, price, category, images, stock, offersEnabled, options } = req.body;

  if (!name || !description || price === undefined || !category) {
    res.status(400);
    throw new Error('name, description, price, and category are required');
  }

  let validatedOptions;
  try {
    validatedOptions = validateOptions(options);
  } catch (err) {
    res.status(err.statusCode || 400);
    throw err;
  }

  const product = await Product.create({
    vendor: vendorProfile._id,
    name,
    description,
    price,
    category,
    images: images || [],
    stock: stock || 0,
    offersEnabled: offersEnabled !== undefined ? offersEnabled : true,
    options: validatedOptions,
  });

  res.status(201).json(product);
});

// @desc    Get products with search, category filter, and pagination
// @route   GET /api/products?search=&category=&page=&limit=
// @access  Public
const getProducts = asyncHandler(async (req, res) => {
  const { search, category, page = 1, limit = 20 } = req.query;

  const query = { status: { $ne: 'disabled' } };
  if (search) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i');
    query.$or = [{ name: regex }, { description: regex }];
  }
  if (category) query.category = category;

  const products = await Product.find(query)
    .populate('vendor', 'storeName ratingAverage')
    .populate('category', 'name slug')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Product.countDocuments(query);

  res.json({
    products,
    page: Number(page),
    totalPages: Math.ceil(total / limit),
    totalResults: total,
  });
});

// @desc    Get a single product by id
// @route   GET /api/products/:id
// @access  Public
const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate({
      path: 'vendor',
      select: 'storeName ratingAverage ratingCount user',
      populate: { path: 'user', select: '_id' }, // exposes the vendor's User id, needed to start a chat conversation
    })
    .populate('category', 'name slug');

  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  res.json(product);
});

// @desc    Get all products belonging to the logged-in vendor
// @route   GET /api/products/mine
// @access  Private/Vendor
const getMyProducts = asyncHandler(async (req, res) => {
  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  if (!vendorProfile) {
    res.status(404);
    throw new Error('Vendor profile not found');
  }

  const products = await Product.find({ vendor: vendorProfile._id }).sort({ createdAt: -1 });
  res.json(products);
});

// @desc    Update a product (only its own vendor can update it)
// @route   PUT /api/products/:id
// @access  Private/Vendor
const updateProduct = asyncHandler(async (req, res) => {
  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  const product = await Product.findById(req.params.id);

  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (!vendorProfile || String(product.vendor) !== String(vendorProfile._id)) {
    res.status(403);
    throw new Error('Not authorized to edit this product');
  }

  const fields = ['name', 'description', 'price', 'category', 'images', 'stock', 'status', 'offersEnabled'];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) product[field] = req.body[field];
  });

  if (req.body.options !== undefined) {
    try {
      product.options = validateOptions(req.body.options);
    } catch (err) {
      res.status(err.statusCode || 400);
      throw err;
    }
  }

  const updated = await product.save();
  res.json(updated);
});

// @desc    Delete a product (only its own vendor can delete it)
// @route   DELETE /api/products/:id
// @access  Private/Vendor
const deleteProduct = asyncHandler(async (req, res) => {
  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  const product = await Product.findById(req.params.id);

  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (!vendorProfile || String(product.vendor) !== String(vendorProfile._id)) {
    res.status(403);
    throw new Error('Not authorized to delete this product');
  }

  await product.deleteOne();
  res.json({ message: 'Product removed' });
});

// @desc    Upload a single product image, returns its public URL
// @route   POST /api/products/upload-image
// @access  Private/Vendor
const uploadProductImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No image file was uploaded');
  }

  // Streams the in-memory buffer straight to Cloudinary — nothing ever
  // touches local disk, so this survives redeploys on any host.
  const uploadResult = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'kobobuy/products' },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(req.file.buffer);
  });

  res.status(201).json({ url: uploadResult.secure_url });
});

// @desc    Get every product on the platform, any status (admin oversight)
// @route   GET /api/products/admin/all
// @access  Private/Admin
const getAllProductsAdmin = asyncHandler(async (req, res) => {
  const products = await Product.find({})
    .populate('vendor', 'storeName status')
    .populate('category', 'name')
    .sort({ createdAt: -1 });
  res.json(products);
});

// @desc    Admin can disable/re-enable any product (moderation), regardless of owner
// @route   PUT /api/products/:id/admin-status
// @access  Private/Admin
const adminUpdateProductStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'disabled'].includes(status)) {
    res.status(400);
    throw new Error("Status must be 'active' or 'disabled'");
  }

  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  product.status = status;
  const updated = await product.save();
  res.json(updated);
});

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  getMyProducts,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  getAllProductsAdmin,
  adminUpdateProductStatus,
};
