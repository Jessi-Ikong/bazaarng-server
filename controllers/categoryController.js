const asyncHandler = require('express-async-handler');
const Category = require('../models/Category');

const slugify = (str) =>
  str.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// @desc    Create a category (top-level or nested under a parent)
// @route   POST /api/categories
// @access  Private/Admin
const createCategory = asyncHandler(async (req, res) => {
  const { name, parentCategory, icon } = req.body;

  if (!name) {
    res.status(400);
    throw new Error('Category name is required');
  }

  const slug = slugify(name);
  const exists = await Category.findOne({ slug });
  if (exists) {
    res.status(400);
    throw new Error('A category with this name already exists');
  }

  if (parentCategory) {
    const parentExists = await Category.findById(parentCategory);
    if (!parentExists) {
      res.status(400);
      throw new Error('Parent category not found');
    }
  }

  const category = await Category.create({
    name,
    slug,
    parentCategory: parentCategory || null,
    icon: icon || null,
  });

  res.status(201).json(category);
});

// @desc    Get all categories as a flat list (frontend builds the tree)
// @route   GET /api/categories
// @access  Public
const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({}).sort({ name: 1 });
  res.json(categories);
});

// @desc    Update a category
// @route   PUT /api/categories/:id
// @access  Private/Admin
const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  if (req.body.name) {
    category.name = req.body.name;
    category.slug = slugify(req.body.name);
  }
  if (req.body.parentCategory !== undefined) {
    category.parentCategory = req.body.parentCategory || null;
  }
  if (req.body.icon !== undefined) {
    category.icon = req.body.icon || null;
  }

  const updated = await category.save();
  res.json(updated);
});

// @desc    Delete a category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  const childCount = await Category.countDocuments({ parentCategory: category._id });
  if (childCount > 0) {
    res.status(400);
    throw new Error('Cannot delete a category that has subcategories — delete or reassign those first');
  }

  await category.deleteOne();
  res.json({ message: 'Category removed' });
});

module.exports = { createCategory, getCategories, updateCategory, deleteCategory };
