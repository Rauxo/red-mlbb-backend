const express = require("express");
const path = require("path");
const colors = require("colors");
const morgan = require("morgan");
const axios = require("axios");
const dotenv = require("dotenv");
const session = require("express-session");
const cors = require("cors");

const connectDB = require("./config/db");
const chatbotRoutes = require("./routes/chatbotRoutes");
const reviewRouter = require("./routes/reviewRoutes.js");

const {
  helmetMw,
  hppMw,
  sanitizeMw,
  ipBlocker,
  apiLimiter,
  authLimiter,
  adminLimiter,
  speedLimiter,
} = require("./middlewares/securityWall");

dotenv.config();
connectDB();

const app = express();
app.set("trust proxy", 1);
app.use(
  express.json({
    limit: "200kb",
  })
);

app.use(express.urlencoded({ extended: false, limit: "200kb" }));

app.use(helmetMw);
app.use(hppMw);
app.use(sanitizeMw);
app.use(ipBlocker);
app.use(speedLimiter);
app.use(apiLimiter);

app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 3 * 60 * 1000,
    },
  })
);

const allowedOrigins = [
  "https://redmlbb.com",
  "https://www.redmlbb.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://10.108.2.191:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
    credentials: true,
  })
);

app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "public")));

app.use("/productImages", express.static(path.join(__dirname, "productImages")));
app.use("/", express.static("productImages"));
app.use("/admin-products", express.static("productImages"));
app.use("/admin-edit-product/:id", express.static("productImages"));
app.use("/admin-view-order/:id", express.static("productImages"));
app.use("/product/", express.static("productImages"));
app.use("/product/:name", express.static("productImages"));

app.use("/accounts", express.static(path.join(__dirname, "accounts")));

app.use("/gallery", express.static(path.join(__dirname, "gallery")));
app.use("/gallery", express.static("gallery"));
app.use("/product/:name", express.static("gallery"));

app.use("/notificationImages", express.static(path.join(__dirname, "notificationImages")));

app.use("/api/user/google-login", authLimiter);
app.use("/api/user/admin/verify-pin", adminLimiter);
app.use("/api/admin", adminLimiter);

app.use("/api/account/", require("./routes/accountRoutes"));
app.use("/api/reviews", reviewRouter);
app.use("/api/user/", require("./routes/userRoutes"));
app.use("/api/admin/", require("./routes/adminRoutes"));
app.use("/api/product/", require("./routes/productRoutes"));

app.use("/api/order/", require("./routes/apiOrderRoutes"));
app.use("/api/order/", require("./routes/orderRoutes"));

app.use("/api/chat", chatbotRoutes);

app.use("/api/payment/", require("./routes/paymentRoutes"));
app.use("/api/service/", require("./routes/apiServiceRoutes.js"));
app.use("/api/media/", require("./routes/adminMediaUploadRouter.js"));
app.use("/api/group/", require("./routes/groupRoutes.js"));
app.use("/api/tab/", require("./routes/tabRoutes.js"));
app.use("/api/stats/", require("./routes/statsRouter.js"));
app.use("/api/cart", require("./routes/cart.js"));
app.use("/api/checkregion/", require("./routes/checkRoutes.js"));


app.get("/api/proxy/:endpoint", async (req, res) => {
  const { endpoint } = req.params;
  const { user_id, server_id, gameCode, id, server_code } = req.query;

  const API_KEY = process.env.RESSELLERHUB_API_KEY || "";
  if (!API_KEY) {
    return res.status(500).json({ message: "Proxy API key not configured" });
  }

  const safeEndpoint = String(endpoint || "").replace(/[^a-zA-Z0-9/_-]/g, "");
  if (!safeEndpoint) return res.status(400).json({ message: "Bad endpoint" });

  try {
    const response = await axios.get(`http://resellerhub.site/${safeEndpoint}`, {
      params: { user_id, server_id, gameCode, id, server_code },
      headers: { "X-API-KEY": API_KEY },
      timeout: 15000,
    });
    return res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    const message =
      error.response?.data?.message ||
      error.message ||
      "An unknown error occurred";
    return res.status(status).json({ message });
  }
});

app.get("/", (req, res) => {
  res.send("API running...");
});

app.use((err, req, res, next) => {
  console.log("ERROR:", err.message);
  res.status(500).json({ success: false, message: err.message || "Server error" });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running in ${process.env.NODE_ENV || "dev"} Mode on Port ${port}`.bgCyan);
});
