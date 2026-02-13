const orderModel = require("../models/orderModel");
const userModel = require("../models/userModel");
const bcrypt = require("bcryptjs");
const sendMail = require("./sendMail");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const moment = require('moment-timezone');


const placeOrderController = async (req, res) => {
  try {
    const existingOrder = await orderModel.findOne({
      orderId: req.body.orderId,
    });
    if (existingOrder) {
      return res
        .status(201)
        .send({ success: false, message: "Order Already Exists" });
    }
    // Deduct User balance
    const user = await userModel.findOne({ email: req.body.email });
    if (!user) {
      return res
        .status(202)
        .send({ success: false, message: "User is not available" });
    }
    const updateBalance = await userModel.findOneAndUpdate(
      { email: req.body.email },
      {
        $set: {
          balance:
            parseInt(user?.balance) - parseInt(req.body.amount) < 0
              ? 0
              : parseInt(user?.balance) - parseInt(req.body.amount),
        },
      },
      { new: true }
    );
    if (!updateBalance) {
      return res.status(200).send({
        success: true,
        message: "Something Went Wrong during Balance Update",
      });
    }
    const newOrder = new orderModel(req.body);
    await newOrder.save();

    //! send mail
    const subject = "Order Successfully Placed!";
    const msg =
      "Your order has been placed successfully. It will complete with a short duration of time.";
    await sendMail(req.body.email, subject, "", msg);

    //! admin mail
    const subjectTwo = "New Order Received!";
    const msgTwo =
      "Hey Admin! You have received a new order. Please login to check.";
    await sendMail(process.env.SENDING_EMAIL, subjectTwo, "", msgTwo);

    return res
      .status(200)
      .send({ success: true, message: "Order place successfull" });
  } catch (error) {
    return res
      .status(500)
      .send({ success: false, message: `Place Order Ctrl ${error.message}` });
  }
};

const getAllOrdersController = async (req, res) => {
  try {
    const orders = await orderModel.find({ email: req.body.email });
    if (orders.length === 0) {
      return res.status(200).send({
        success: false,
        message: "No Order Found",
      });
    }
    return res.status(201).send({
      success: true,
      message: "All Orders Fetched Success",
      data: orders,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Get All Orders Ctrl ${error.message}`,
    });
  }
};

const getOrderByIdController = async (req, res) => {
  try {
    const order = await orderModel.findOne({
      orderId: req.body.orderId,
    });
    if (!order) {
      return res.status(200).send({
        success: false,
        message: "No Order Found",
      });
    }
    return res.status(201).send({
      success: true,
      message: "Order Fetched Success",
      data: order,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Get Order By Id Ctrl ${error.message}`,
    });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    let { email } = req.body;
    const loginResponse = await axios.post(
      "https://api.bigpapastore.com/v1/login",
      {
        login: process.env.LOGIN,
        password: process.env.PASSWORD,
      }
    );
    if (loginResponse.data.status === "ACTIVE") {
      const authToken = loginResponse.data.token;
      const ordersWithZoneId = await orderModel.find({
        customer_email: email,
        zoneId: { $ne: null },
      });
      for (const order of ordersWithZoneId) {
        const orderId = order.resId; // Assuming resId is the order ID
        const apiUrl = `https://api.bigpapastore.com/v1/order/${orderId}`;
        const apiResponse = await axios.get(apiUrl, {
          headers: {
            Authorization: "Bearer " + authToken,
          },
        });
        const orderStatus = apiResponse.data.status;
        await orderModel.updateOne({ resId: orderId }, { status: orderStatus });
      }
      return res
        .status(200)
        .send({ success: true, message: "Order Status Updated" });
    } else {
      console.log("Login failed. Wrong login or password");
    }
  } catch (error) {
    console.error("Error updating order status:", error);
  }
};

const trackOrderController = async (req, res) => {
  try {
    const { client_txn_id, email } = req.body;
    if (req.body.email) {
      const orders = await orderModel.find({
        customer_email: email,
      });
      if (!orders) {
        return res
          .status(200)
          .send({ success: false, message: "No order found" });
      }
      return res.status(201).send({
        success: true,
        message: "Order Fetched Success",
        data: orders,
      });
    } else {
      const orders = await orderModel.findOne({
        client_txn_id: client_txn_id,
      });
      if (!orders) {
        return res
          .status(200)
          .send({ success: false, message: "No order found" });
      }
      return res.status(201).send({
        success: true,
        message: "Order Fetched Success",
        data: orders,
      });
    }
  } catch (error) {
    return res
      .status(500)
      .send({ success: false, message: `Track Order Ctrl ${error.message}` });
  }
};

const updateResIdController = async (req, res) => {
  try {
    const order = await orderModel.findOne({
      client_txn_id: req.body.client_txn_id,
    });
    if (!order) {
      return res
        .status(200)
        .send({ success: false, message: "No order found" });
    }
    const updateOrder = await orderModel.findOneAndUpdate(
      {
        client_txn_id: req.body.client_txn_id,
      },
      { $set: { resId: req.body.resId } },
      { new: true }
    );
    if (updateOrder) {
      return res.status(201).send({ success: true, message: "Res Id Updated" });
    }
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Update Res Id Ctrl ${error.message}`,
    });
  }
};

const orderSumController = async (req, res) => {
  const result = await orderModel.aggregate([
    {
      $group: {
        _id: null,
        totalSales: {
          $sum: { $toDouble: "$amount" }
        }
      }
    }
  ])
  const total = result[0]?.totalSales || 0;
  
  return res.status(201).send({ success: true, total: total });
}
const todayOrderSumController = async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const result = await orderModel.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startOfDay,
            $lte: endOfDay
          }
        }
      },
      {
        $group: {
          _id: null,
          totalSales: {
            $sum: { $toDouble: "$amount" }
          },
          totalOrders: { $sum: 1 }
        }
      }
    ]);

    const totalSales = result[0]?.totalSales || 0;
    const totalOrders = result[0]?.totalOrders || 0;

    return res.status(201).send({
      success: true,
      message: "Today's Orders Fetched Success",
      data: {
        totalSales,
        totalOrders
      }
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Today Order Sum Ctrl ${error.message}`
    });
  }
};
// Add these controller functions to orderCtrl.js

// orderCtrl.js

const IST = 'Asia/Kolkata';

// TODAY SALES
const getTodayTotalSalesController = async (req, res) => {
  try {
    const now = moment().tz(IST);
    const startOfDay = now.clone().startOf('day').toDate();
    const endOfDay = now.clone().endOf('day').toDate();

    const result = await orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        }
      },
      {
        $group: {
          _id: null,
          todaySales: { $sum: { $toDouble: "$amount" } }
        }
      }
    ]);

    return res.status(200).send({
      success: true,
      todaySales: result[0]?.todaySales || 0
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Today Sales Ctrl Error: ${error.message}`
    });
  }
};

// TODAY ORDERS
const getTodayTotalOrdersController = async (req, res) => {
  try {
    const now = moment().tz(IST);
    const startOfDay = now.clone().startOf('day').toDate();
    const endOfDay = now.clone().endOf('day').toDate();

    const todayOrders = await orderModel.countDocuments({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    return res.status(200).send({
      success: true,
      todayOrders
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Today Orders Ctrl Error: ${error.message}`
    });
  }
};

// LAST 7 DAYS SALES
const getLast7DaysSalesController = async (req, res) => {
  try {
    const dailySales = [];
    const today = moment().tz(IST);

    for (let i = 6; i >= 0; i--) {
      const date = today.clone().subtract(i, 'days');
      const startOfDay = date.clone().startOf('day').toDate();
      const endOfDay = date.clone().endOf('day').toDate();

      const result = await orderModel.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfDay, $lte: endOfDay }
          }
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: { $toDouble: "$amount" } }
          }
        }
      ]);

      const dayName = date.format('ddd'); // e.g., Mon, Tue
      dailySales.push({
        day: dayName,
        sales: result[0]?.totalSales || 0
      });
    }

    return res.status(200).send({
      success: true,
      data: dailySales
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Sales Chart Error: ${error.message}`
    });
  }
};
module.exports = {
  placeOrderController,
  trackOrderController,
  getAllOrdersController,
  getOrderByIdController,
  updateResIdController,
  updateOrderStatus,
  orderSumController,
 todayOrderSumController,
 getTodayTotalSalesController,       // Add this
  getTodayTotalOrdersController,       // Add this
getLast7DaysSalesController
};
