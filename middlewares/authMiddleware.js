const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");

function getBearerToken(req) {
  const h = req.headers["authorization"] || "";
  if (!h.startsWith("Bearer ")) return "";
  return h.slice(7).trim();
}

module.exports = async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ success: false, message: "Token missing" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const u = await userModel.findById(decoded.id).select("block isAdmin").lean();
    if (!u) return res.status(401).json({ success: false, message: "User not found" });
    if (u.block === "yes") return res.status(403).json({ success: false, message: "Account blocked" });

    req.user = {
      id: decoded.id,
      isAdmin: !!decoded.isAdmin,
      adminVerified: !!decoded.adminVerified,
    };

    next();
  } catch (err) {
    console.error("authMiddleware:", err);
    return res.status(500).json({ success: false, message: "Auth error" });
  }
};
