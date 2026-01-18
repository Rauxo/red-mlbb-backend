module.exports = function (req, res, next) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();

  // allow empty UA for server-to-server webhooks if needed
  if (!ua) return next();

  // block basic tool UAs
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
};
