const asyncHandler = require('express-async-handler');
const PromoSlide = require('../models/PromoSlide');

// @desc    Get active promo slides for the homepage carousel
// @route   GET /api/promo-slides
// @access  Public
const getActivePromoSlides = asyncHandler(async (req, res) => {
  const slides = await PromoSlide.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
  res.json(slides);
});

// @desc    Get every promo slide, active or not (admin management view)
// @route   GET /api/promo-slides/admin/all
// @access  Private/Admin
const getAllPromoSlidesAdmin = asyncHandler(async (req, res) => {
  const slides = await PromoSlide.find({}).sort({ order: 1, createdAt: 1 });
  res.json(slides);
});

// @desc    Create a promo slide
// @route   POST /api/promo-slides
// @access  Private/Admin
const createPromoSlide = asyncHandler(async (req, res) => {
  const { image, title, link, isActive, order } = req.body;

  if (!image) {
    res.status(400);
    throw new Error('Slide image is required');
  }

  const slide = await PromoSlide.create({
    image,
    title,
    link,
    isActive: isActive !== undefined ? isActive : true,
    order: order || 0,
  });

  res.status(201).json(slide);
});

// @desc    Update a promo slide
// @route   PUT /api/promo-slides/:id
// @access  Private/Admin
const updatePromoSlide = asyncHandler(async (req, res) => {
  const slide = await PromoSlide.findById(req.params.id);
  if (!slide) {
    res.status(404);
    throw new Error('Promo slide not found');
  }

  const fields = ['image', 'title', 'link', 'isActive', 'order'];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) slide[field] = req.body[field];
  });

  const updated = await slide.save();
  res.json(updated);
});

// @desc    Delete a promo slide
// @route   DELETE /api/promo-slides/:id
// @access  Private/Admin
const deletePromoSlide = asyncHandler(async (req, res) => {
  const slide = await PromoSlide.findById(req.params.id);
  if (!slide) {
    res.status(404);
    throw new Error('Promo slide not found');
  }

  await slide.deleteOne();
  res.json({ message: 'Promo slide removed' });
});

module.exports = {
  getActivePromoSlides,
  getAllPromoSlidesAdmin,
  createPromoSlide,
  updatePromoSlide,
  deletePromoSlide,
};
