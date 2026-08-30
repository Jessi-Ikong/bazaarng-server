require("dotenv").config();
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
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
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

app.get("/", (req, res) => res.send("KoboBuy API is running"));
app.get("/sitemap.xml", getSitemap);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`KoboBuy server running on port ${PORT}`));
