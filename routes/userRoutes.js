const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");

const {
  googleLoginController,
  adminVerifyPinController,
  userProfileUpdateController,
  getUserDataController,
} = require("../controllers/userCtrl");

const router = express.Router();

// public
router.post("/google-login", googleLoginController);

router.post("/admin/verify-pin", authMiddleware, adminVerifyPinController);

// protected
router.post("/profile/update", authMiddleware, userProfileUpdateController);
router.post("/getUserData", authMiddleware, getUserDataController);

module.exports = router;
