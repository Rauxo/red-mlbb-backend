const express = require("express");
const {
  todayOrderSumController,
  trackOrderController,
  getAllOrdersController,
  getOrderByIdController,
  orderSumController,
  getTodayTotalSalesController,       
  getTodayTotalOrdersController,
  getLast7DaysSalesController,       
} = require("../controllers/orderCtrl");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/get-user-orders", authMiddleware, getAllOrdersController);
router.post("/get-order-by-id", authMiddleware, getOrderByIdController);
router.post("/track-order", authMiddleware, trackOrderController);
router.get("/sum", authMiddleware, orderSumController);
router.get("/today-sum", authMiddleware, todayOrderSumController);
router.get("/last7days-sales", authMiddleware, getLast7DaysSalesController);
router.get("/today-sales", authMiddleware, getTodayTotalSalesController);
router.get("/today-orders", authMiddleware, getTodayTotalOrdersController);
module.exports = router;
