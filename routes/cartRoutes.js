const express = require('express');
const router = express.Router();
const {
  getCart,
  addItemToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  getDeliveryFeePreview,
} = require('../controllers/cartController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect); // every cart route requires a logged-in user

router.get('/', getCart);
router.get('/delivery-preview', getDeliveryFeePreview);
router.delete('/', clearCart);
router.post('/items', addItemToCart);
router.put('/items/:itemId', updateCartItem);
router.delete('/items/:itemId', removeCartItem);

module.exports = router;
