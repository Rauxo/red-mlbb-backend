const mongoose = require("mongoose");
const paymentSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    amount: {
      type: String,
      required: true,
    },
    mobile: {
      type: String,
      required: true,
    },
    status: {
      type: String,
    },
    utrNumber: {
      type: String,
      required: true,
    },
    payDate: {
      type: Date,
      default: Date.now(),
    },
  },
  {
    timestamps: true,
  }
);

const paymentModel = mongoose.model("payments", paymentSchema);
module.exports = paymentModel;
