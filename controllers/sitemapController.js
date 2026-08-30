const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const Category = require('../models/Category');
const VendorProfile = require('../models/VendorProfile');

// @desc    Dynamically generated sitemap.xml — since this is a client-
//          rendered SPA, this is the one piece of "SEO basics" that
//          genuinely can't be done client-side: it needs the current,
//          real list of products/categories/vendors from the database.
// @route   GET /sitemap.xml
// @access  Public
const getSitemap = asyncHandler(async (req, res) => {
  const baseUrl = process.env.CLIENT_URL || 'http://localhost:5173';

  const [products, categories, vendors] = await Promise.all([
    Product.find({ status: 'active' }).select('_id updatedAt'),
    Category.find({}).select('slug'),
    VendorProfile.find({ status: 'approved' }).select('_id'),
  ]);

  const staticUrls = [
    { loc: `${baseUrl}/`, priority: '1.0' },
    { loc: `${baseUrl}/search`, priority: '0.5' },
  ];
  const productUrls = products.map((p) => ({
    loc: `${baseUrl}/products/${p._id}`,
    lastmod: p.updatedAt?.toISOString().split('T')[0],
    priority: '0.8',
  }));
  const categoryUrls = categories.map((c) => ({
    loc: `${baseUrl}/category/${c.slug}`,
    priority: '0.7',
  }));
  const vendorUrls = vendors.map((v) => ({
    loc: `${baseUrl}/store/${v._id}`,
    priority: '0.6',
  }));

  const allUrls = [...staticUrls, ...productUrls, ...categoryUrls, ...vendorUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.send(xml);
});

module.exports = { getSitemap };
