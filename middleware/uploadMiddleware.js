const multer = require('multer');

// Switched from disk storage to memory storage: files are held as an
// in-memory buffer just long enough to stream to Cloudinary, then
// discarded — nothing is ever written to the server's local filesystem.
// This is the actual fix for the earlier known risk that local disk
// uploads would silently vanish on redeploy on most cloud hosts.
const storage = multer.memoryStorage();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = upload;
