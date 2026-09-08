const express = require('express');
const router = express.Router();
const {
  checkout,
  initiateDeliveryPayment,
  retryOrderPayment,
  getMyOrders,
  getVendorOrders,
  getOrderById,
  getOrderReceipt,
  updateOrderStatus,
  getAllOrdersAdmin,
} = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { checkoutLimiter } = require('../middleware/rateLimitMiddleware');

// IMPORTANT: /mine, /vendor, and /admin/all must come before /:id, same reasoning as productRoutes
router.post('/checkout', protect, authorize('customer'), checkoutLimiter, checkout);
router.get('/mine', protect, authorize('customer'), getMyOrders);
router.get('/vendor', protect, authorize('vendor'), getVendorOrders);
router.get('/admin/all', protect, authorize('admin'), getAllOrdersAdmin);
router.get('/:id', protect, getOrderById);
router.get('/:id/receipt', protect, getOrderReceipt);
router.put('/:id/status', protect, authorize('vendor'), updateOrderStatus);
router.post('/:id/initiate-delivery-payment', protect, authorize('customer'), initiateDeliveryPayment);
router.post('/:id/retry-payment', protect, authorize('customer'), retryOrderPayment);

module.exports = router;
