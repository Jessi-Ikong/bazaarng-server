const express = require('express');
const router = express.Router();
const {
  createProduct,
  getProducts,
  getProductById,
  getMyProducts,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  getAllProductsAdmin,
  adminUpdateProductStatus,
} = require('../controllers/productController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');

// IMPORTANT: /mine, /admin/all, and /upload-image must be declared before
// /:id, or Express will treat them as :id values.
router.get('/mine', protect, authorize('vendor'), getMyProducts);
router.get('/admin/all', protect, authorize('admin'), getAllProductsAdmin);
router.post('/upload-image', protect, authorize('vendor'), upload.single('image'), uploadProductImage);

router.get('/', getProducts);
router.get('/:id', getProductById);
router.post('/', protect, authorize('vendor'), createProduct);
router.put('/:id', protect, authorize('vendor'), updateProduct);
router.put('/:id/admin-status', protect, authorize('admin'), adminUpdateProductStatus);
router.delete('/:id', protect, authorize('vendor'), deleteProduct);

module.exports = router;
