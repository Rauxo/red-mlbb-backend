const multer = require("multer");
const express = require("express");
const adminAuthMiddleware = require("../middlewares/adminAuthMiddleware");
const userModel = require("../models/userModel");

const {
  getAllUserController,
  getUserController,
  getAllResellerUsersController,
  editUserController,
  deleteUserController,
  sendMailToIncompleteUsersController,
  adminGetAllOrdersController,
  adminUpdateOrderController,
  getAllPaymentsController,
  adminAdjustUserBalanceController,
  adminGetWalletHistoryController,
  getCurrentMonthSales,
} = require("../controllers/AdminCtrl");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "adsImages"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "--" + file.originalname.replace(/\s+/g, "-")),
});

const upload = multer({ storage });

router.get("/get-all-payments", adminAuthMiddleware, getAllPaymentsController);

router.get("/get-all-users", adminAuthMiddleware, getAllUserController);
router.post("/get-user", adminAuthMiddleware, getUserController);
router.post("/delete-user", adminAuthMiddleware, deleteUserController);
router.post("/admin-edit-user", adminAuthMiddleware, editUserController);
router.get("/get-all-reseller", adminAuthMiddleware, getAllResellerUsersController);
router.get("/current-month-sales", adminAuthMiddleware,getCurrentMonthSales );

router.get("/admin-get-all-orders", adminAuthMiddleware, adminGetAllOrdersController);
router.post("/update-order", adminAuthMiddleware, adminUpdateOrderController);

router.post(
  "/send-mail-to-incomplete-profiles",
  adminAuthMiddleware,
  sendMailToIncompleteUsersController
);

router.get("/get-all-resellers", adminAuthMiddleware, async (req, res) => {
  try {
    const resellers = await userModel.find({ reseller: "yes" }).lean();
    res.json({ success: true, data: resellers });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

router.post("/user/balance-adjust", adminAuthMiddleware, adminAdjustUserBalanceController);

router.get("/wallet-history", adminAuthMiddleware, adminGetWalletHistoryController);

module.exports = router;
