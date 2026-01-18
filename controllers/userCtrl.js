const userModel = require("../models/userModel");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

// ===== helpers =====
function requireEnv(name) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

function signJwt(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

function normalizeMobile(m) {
  return String(m || "").replace(/\s+/g, "").replace(/[^\d+]/g, "");
}

function randomStrongPassword() {
  return crypto.randomBytes(32).toString("hex");
}

// ===== Google =====
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleIdToken(idToken) {
  if (!GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID not configured");
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
}

const _pinAttempts = new Map();
function checkPinRateLimit(key) {
  const now = Date.now();
  const rec = _pinAttempts.get(key);
  if (!rec || now > rec.resetAt) {
    _pinAttempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return { ok: true };
  }
  rec.count += 1;
  if (rec.count > 10) return { ok: false };
  return { ok: true };
}

const RESP_ENC_KEY_HEX = requireEnv("RESP_ENC_KEY"); 

function encryptBalance(balanceNumber) {
  const key = Buffer.from(RESP_ENC_KEY_HEX, "hex");
  if (key.length !== 32) throw new Error("RESP_ENC_KEY must be 32 bytes (64 hex)");

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

  const plaintext = String(balanceNumber ?? 0);
  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return {
    id: encrypted.toString("hex"),
    key: key.toString("hex"),
    iv: iv.toString("hex"),
  };
}

const googleLoginController = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ success: false, message: "idToken required" });

    const payload = await verifyGoogleIdToken(idToken);

    const email = String(payload.email || "").toLowerCase().trim();
    const googleId = String(payload.sub || "").trim();
    const name = String(payload.name || payload.given_name || "").trim();
    const avatar = String(payload.picture || "").trim();
    const emailVerified = !!payload.email_verified;

    if (!email || !googleId) {
      return res.status(401).json({ success: false, message: "Invalid Google token" });
    }
    if (!emailVerified) {
      return res.status(401).json({ success: false, message: "Google email not verified" });
    }

    let user = await userModel.findOne({ googleId });

    if (!user) {
      const byEmail = await userModel.findOne({ email });

      if (byEmail) {
        if (byEmail.block === "yes") {
          return res.status(403).json({ success: false, message: "Account blocked" });
        }

        if (byEmail.googleId && byEmail.googleId !== googleId) {
          return res.status(409).json({
            success: false,
            message: "This email is already linked to another Google account",
          });
        }

        byEmail.googleId = googleId;
        if (name) byEmail.fname = byEmail.fname || name;
        if (avatar) byEmail.avatar = avatar;
        byEmail.emailVerified = true;
        byEmail.lastLogin = new Date();

        user = await byEmail.save();
      } else {
        user = await userModel.create({
          email,
          googleId,
          fname: name || "",
          avatar: avatar || "",
          emailVerified: true,
          password: randomStrongPassword(),
          lastLogin: new Date(),
        });
      }
    } else {
      if (user.block === "yes") {
        return res.status(403).json({ success: false, message: "Account blocked" });
      }

      if (name && !user.fname) user.fname = name;
      if (avatar) user.avatar = avatar;
      user.emailVerified = true;
      user.lastLogin = new Date();
      await user.save();
    }

    const isAdmin = !!user.isAdmin;

    const baseToken = signJwt(
      { id: String(user._id), isAdmin, adminVerified: false },
      isAdmin ? "12h" : "30d"
    );

    return res.status(200).json({
      success: true,
      message: isAdmin ? "Google login ok. Admin PIN required." : "Login successful",
      token: baseToken,
      requiresAdminPin: isAdmin,
      isAdmin,
    });
  } catch (err) {
    console.error("googleLoginController:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const adminVerifyPinController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const ip =
      (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
        .toString()
        .split(",")[0]
        .trim();

    const rlKey = `${ip}:${userId}`;
    const rl = checkPinRateLimit(rlKey);
    if (!rl.ok) {
      return res.status(429).json({ success: false, message: "Too many attempts. Try later." });
    }

    const { pin } = req.body;
    if (!pin) return res.status(400).json({ success: false, message: "PIN required" });

    const user = await userModel.findById(userId).select("isAdmin block").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.block === "yes") return res.status(403).json({ success: false, message: "Account blocked" });
    if (!user.isAdmin) return res.status(403).json({ success: false, message: "Not an admin account" });

    const envHash = (process.env.ADMIN_PIN_HASH || "").trim();
    if (!envHash) {
      return res.status(500).json({ success: false, message: "ADMIN_PIN_HASH not configured" });
    }

    const ok = await bcrypt.compare(String(pin), envHash);
    if (!ok) return res.status(401).json({ success: false, message: "Wrong PIN" });

    const adminToken = signJwt(
      { id: String(userId), isAdmin: true, adminVerified: true },
      "6h"
    );

    return res.status(200).json({
      success: true,
      message: "Admin verified",
      token: adminToken,
      isAdmin: true,
    });
  } catch (err) {
    console.error("adminVerifyPinController:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const userProfileUpdateController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { fname, mobile } = req.body;

    const user = await userModel.findById(userId).select("email block mobile mobileLocked").lean();
    if (!user) return res.status(404).json({ success: false, message: "User Not Found" });
    if (user.block === "yes") return res.status(403).json({ success: false, message: "Account blocked" });

    if ((user.email || "").toLowerCase() === (process.env.CLIENT_EMAIL || "").toLowerCase()) {
      return res.status(403).json({ success: false, message: "You are not allowed to update this user" });
    }

    const updateData = {};

    if (typeof fname === "string" && fname.trim()) {
      updateData.fname = fname.trim().slice(0, 60);
    }

    if (mobile !== undefined) {
      const m = normalizeMobile(mobile);
      if (!m) return res.status(400).json({ success: false, message: "Invalid mobile" });

      if (user.mobileLocked === true) {
        return res.status(403).json({
          success: false,
          message: "Mobile already set. You cannot change it again.",
        });
      }

      if (user.mobile && String(user.mobile).trim()) {
        await userModel.updateOne({ _id: userId }, { $set: { mobileLocked: true } });
        return res.status(403).json({
          success: false,
          message: "Mobile already exists. It is locked and cannot be changed.",
        });
      }

      const exists = await userModel.findOne({ _id: { $ne: userId }, mobile: m }).lean();
      if (exists) return res.status(409).json({ success: false, message: "Mobile already in use" });

      updateData.mobile = m;
      updateData.mobileLocked = true;
      updateData.mobileSetAt = new Date();
      updateData.mobileVerified = true;
    }

    if (!Object.keys(updateData).length) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }

    await userModel.updateOne({ _id: userId }, { $set: updateData });

    return res.status(200).json({ success: true, message: "Profile Updated" });
  } catch (err) {
    console.error("userProfileUpdateController:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getUserDataController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const user = await userModel.findById(userId).lean();
    if (!user) return res.status(401).json({ success: false, message: "User not found" });

    delete user.googleId;

    const enc = encryptBalance(user.balance);

    return res.status(200).json({
      success: true,
      data: {
        user,
        id: enc.id,
        key: enc.key,
        iv: enc.iv,
      },
    });
  } catch (err) {
    console.error("getUserDataController:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  googleLoginController,
  adminVerifyPinController,
  userProfileUpdateController,
  getUserDataController,
};
