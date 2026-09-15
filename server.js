require("dotenv").config();
const Sentry = require("@sentry/node");
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}

// Last-resort safety nets: without these, an uncaught exception or an
// unhandled promise rejection crashes Node immediately and silently — all
// Render shows is "Exited with status 1", no indication of why. This logs
// the full error and reports it to Sentry BEFORE exiting, so a crash
// restart is still visible and diagnosable instead of an unexplained
// crash-loop. For a genuinely unrecoverable error, the process is in an
// undefined state past this point, so it's still correct to exit
// afterward — Sentry.close() just makes sure the report actually reaches
// Sentry first.
function crashSafely(label, err) {
  console.error(`[${new Date().toISOString()}] ${label}:`, err);
  Sentry.captureException(err);
  Sentry.close(2000).then(() => process.exit(1));
}
process.on("uncaughtException", (err) => crashSafely("Uncaught exception", err));
process.on("unhandledRejection", (reason) => crashSafely("Unhandled promise rejection", reason));

const express = require("express");
const path = require("path");
const cors = require("cors");
const connectDB = require("./config/db");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const offerRoutes = require("./routes/offerRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const earningsRoutes = require("./routes/earningsRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const chatRoutes = require("./routes/chatRoutes");
const promoSlideRoutes = require("./routes/promoSlideRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const { getSitemap } = require("./controllers/sitemapController");

connectDB();

const app = express();
// Only the actual frontend(s) should be allowed to call this API from a
// browser — wide-open CORS was fine for local dev, but shouldn't carry
// into production. CLIENT_URL is already an env var used elsewhere
// (Paystack callbacks, email links), so it doubles as the CORS whitelist
// here too. localhost stays allowed alongside it for continued local dev
// against a deployed backend.
const allowedOrigins = [process.env.CLIENT_URL, "http://localhost:5173"].filter(
  Boolean,
);
// "https://www.example.com" and "https://example.com" are the same site,
// but an exact string match treats them as different origins — strip a
// leading "www." (only at the start, not anywhere else in the string)
// from both sides before comparing so either form of CLIENT_URL works.
const stripLeadingWww = (url) => url.replace(/^https:\/\/www\./, "https://");
const normalizedAllowedOrigins = allowedOrigins.map(stripLeadingWww);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || normalizedAllowedOrigins.includes(stripLeadingWww(origin))) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  }),
);

// The Paystack webhook needs the raw request body to verify its signature,
// so it's mounted with express.raw() here, BEFORE the global express.json()
// below — otherwise the body would already be parsed into an object and
// the signature check would fail. Every other route uses JSON as normal.
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// Uploaded product images are served directly from disk at /uploads/<filename>
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/earnings", earningsRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/promo-slides", promoSlideRoutes);
app.use("/api/analytics", analyticsRoutes);

app.get("/", (req, res) => res.send("BazaarNG API is running"));
app.get("/sitemap.xml", getSitemap);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`BazaarNG server running on port ${PORT}`));
