const mongoose = require("mongoose");

const paymentRequestSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
    },
    txn_note: {
      type: String,
    },
    customer_email: {
      type: String,
    },
    customer_mobile: {
      type: String,
    },
    txn_amount: {
      type: String,
    },
    orderType: { type: String, enum: ["cart", "product", "balance"] }, // ✅ Add this
    cart: { type: Array, default: [] },
    product_name: {
      type: String,
      default: null,
    },
    customer_name: {
      type: String,
    },
    status: {
      type: String,
      enum: [
        "pending", // payment created
        "processing", // payment confirmed
        "completed", // ALL items delivered
        "failed", // ANY item failed
      ],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

const paymentRequestModel = mongoose.model(
  "paymentRequest",
  paymentRequestSchema
);
module.exports = paymentRequestModel;
