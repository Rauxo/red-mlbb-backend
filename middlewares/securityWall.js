// backend/middleware/securityWall.js
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const hpp = require("hpp");
const mongoSanitize = require("express-mongo-sanitize");

function getClientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").toString();
  if (xff) return xff.split(",")[0].trim();
  return req.ip;
}

function ipBlocker(req, res, next) {
  const blocked = (process.env.BLOCK_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!blocked.length) return next();

  const ip = getClientIp(req);
  if (blocked.includes(ip)) {
    return res.status(403).json({ success: false, message: "Blocked" });
  }
  next();
}

function suspiciousUA(req, res, next) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();

  const bad =
    ua.includes("curl") ||
    ua.includes("wget") ||
    ua.includes("python") ||
    ua.includes("postman") ||
    ua.includes("insomnia");

  if (bad) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  next();
}

// ---- Rate limiters ----
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 240,           
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests" },
});

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, 
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many auth attempts" },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Admin rate limited" },
});

const speedLimiter = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 120,
  delayMs: () => 500,
});

module.exports = {
  helmetMw: helmet({
    crossOriginResourcePolicy: false,
  }),
  hppMw: hpp(),
  sanitizeMw: mongoSanitize({
    replaceWith: "_",
  }),
  jsonLimitMw: (req, res, next) => {
    next();
  },

  ipBlocker,
  suspiciousUA,
  apiLimiter,
  authLimiter,
  adminLimiter,
  speedLimiter,
};
