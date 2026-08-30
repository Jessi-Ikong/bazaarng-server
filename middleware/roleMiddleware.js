// Usage: authorize('admin') or authorize('vendor', 'admin')
// Must run after `protect` so req.user is already set.
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403);
      throw new Error(`Not authorized — requires role: ${allowedRoles.join(' or ')}`);
    }
    next();
  };
};

module.exports = { authorize };
