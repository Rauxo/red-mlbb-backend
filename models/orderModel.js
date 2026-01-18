const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    api: {
      type: String,
    },
    orderId: {
      type: String,
      unique: true,
    },
    productinfo: {
      type: String,
    },
    amount: {
      type: String,
    },
    email: {
      type: String,
    },
    mobile: {
      type: String,
    },
    orderDetails: {
      type: String,
      default: null,
    },
    userId: {
      type: String,
      default: null,
    },
    zoneId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      default: "pending",
    },
    parentOrderId: { type: String }, // For grouping cart items
    cartItemIndex: { type: Number }, // Which item in cart
    orderType: {
      type: String,
      enum: ["single", "cart"],
      default: "single",
    },
    orderDate: {
      type: Date,
      default: Date.now(),
    },
  },
  {
    timestamps: true,
  }
);

const orderModel = mongoose.model("order", orderSchema);
module.exports = orderModel;
