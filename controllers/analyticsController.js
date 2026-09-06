const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const Earnings = require('../models/Earnings');
const Product = require('../models/Product');
const User = require('../models/User');
const VendorProfile = require('../models/VendorProfile');

const ORDER_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const DAYS_WINDOW = 30;

// Builds the last N calendar days (oldest first, ending today) as
// 'YYYY-MM-DD' strings, so the sales chart always gets a continuous
// series even for days with zero paid orders.
function lastNDays(n) {
  const days = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function buildSalesOverTime(aggregatedRows) {
  const byDate = new Map(aggregatedRows.map((row) => [row._id, row]));
  return lastNDays(DAYS_WINDOW).map((date) => {
    const row = byDate.get(date);
    return {
      date,
      revenue: row ? row.revenue : 0,
      orderCount: row ? row.orderCount : 0,
    };
  });
}

const salesOverTimeStages = (matchExtra) => [
  {
    $match: {
      paymentStatus: 'paid',
      paidAt: { $gte: new Date(Date.now() - DAYS_WINDOW * 24 * 60 * 60 * 1000) },
      ...matchExtra,
    },
  },
  {
    $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
      revenue: { $sum: '$totalAmount' },
      orderCount: { $sum: 1 },
    },
  },
];

// @desc    Get the logged-in vendor's sales analytics
// @route   GET /api/analytics/vendor
// @access  Private/Vendor
const getVendorAnalytics = asyncHandler(async (req, res) => {
  const vendorProfile = await VendorProfile.findOne({ user: req.user._id });
  if (!vendorProfile) {
    res.status(404);
    throw new Error('Vendor profile not found');
  }
  const vendorId = vendorProfile._id;

  const [salesRows, topProductRows, statusRows, paidTotals, netTotalRows] = await Promise.all([
    Order.aggregate(salesOverTimeStages({ vendor: vendorId })),
    Order.aggregate([
      { $match: { vendor: vendorId, paymentStatus: 'paid' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $first: '$items.name' },
          unitsSold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.priceAtPurchase', '$items.quantity'] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([
      { $match: { vendor: vendorId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { vendor: vendorId, paymentStatus: 'paid' } },
      { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
    ]),
    Earnings.aggregate([
      { $match: { vendor: vendorId } },
      { $group: { _id: null, totalNet: { $sum: '$netAmount' } } },
    ]),
  ]);

  const statusBreakdown = ORDER_STATUSES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {});
  let totalOrders = 0;
  statusRows.forEach((row) => {
    if (row._id in statusBreakdown) statusBreakdown[row._id] = row.count;
    totalOrders += row.count;
  });

  const totalRevenue = paidTotals[0]?.totalRevenue || 0;
  const paidOrderCount = paidTotals[0]?.orderCount || 0;

  res.json({
    salesOverTime: buildSalesOverTime(salesRows),
    topProducts: topProductRows.map((row) => ({
      productId: row._id,
      name: row.name,
      unitsSold: row.unitsSold,
      revenue: row.revenue,
    })),
    summary: {
      totalOrders,
      totalRevenue,
      totalNet: netTotalRows[0]?.totalNet || 0,
      averageOrderValue: paidOrderCount > 0 ? totalRevenue / paidOrderCount : 0,
      statusBreakdown,
    },
  });
});

// @desc    Get platform-wide sales analytics
// @route   GET /api/analytics/admin
// @access  Private/Admin
const getAdminAnalytics = asyncHandler(async (req, res) => {
  const [
    salesRows,
    topVendorRows,
    platformRevenueRows,
    totalUsers,
    totalVendors,
    pendingVendors,
    totalProducts,
    totalOrders,
  ] = await Promise.all([
    Order.aggregate(salesOverTimeStages({})),
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: '$vendor', revenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, totalPlatformRevenue: { $sum: '$totalAmount' } } },
    ]),
    User.countDocuments({}),
    VendorProfile.countDocuments({}),
    VendorProfile.countDocuments({ status: 'pending' }),
    Product.countDocuments({}),
    Order.countDocuments({}),
  ]);

  // Avoid $lookup here (established codebase convention — see
  // chatController.getMyConversations): batch-fetch the store names
  // separately and merge them in JS instead.
  const vendorIds = topVendorRows.map((row) => row._id);
  const vendorProfiles = await VendorProfile.find({ _id: { $in: vendorIds } }).select('storeName');
  const storeNameById = new Map(vendorProfiles.map((v) => [v._id.toString(), v.storeName]));

  res.json({
    platformSalesOverTime: buildSalesOverTime(salesRows),
    topVendors: topVendorRows.map((row) => ({
      vendorId: row._id,
      storeName: storeNameById.get(row._id.toString()) || 'Unknown vendor',
      revenue: row.revenue,
      orderCount: row.orderCount,
    })),
    summary: {
      totalUsers,
      totalVendors,
      pendingVendors,
      totalProducts,
      totalOrders,
      totalPlatformRevenue: platformRevenueRows[0]?.totalPlatformRevenue || 0,
    },
  });
});

module.exports = { getVendorAnalytics, getAdminAnalytics };
