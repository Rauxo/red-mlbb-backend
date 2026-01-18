// models/walletHistoryModel.js
const mongoose = require("mongoose");

const walletHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "users", index: true },
    email: { type: String, default: "", lowercase: true, trim: true, index: true },

    amount: { type: Number, required: true }, // always positive
    type: { type: String, enum: ["CREDIT", "DEBIT"], required: true },

    mode: {
      type: String,
      enum: ["ADMIN_ADJUST", "WALLET_RECHARGE", "ORDER_DEBIT", "REFUND", "SYSTEM"],
      default: "ADMIN_ADJUST",
      index: true,
    },

    transaction_id: { type: String, required: true, unique: true, index: true },

    status: { type: String, enum: ["SUCCESS", "FAILED", "PENDING"], default: "SUCCESS", index: true },

    message: { type: String, default: "", trim: true },

    changedByAdmin: { type: Boolean, default: false, index: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "users", index: true },
    ip: { type: String, default: "" },

    balanceBefore: { type: Number },
    balanceAfter: { type: Number },
  },
  { timestamps: true }
);

walletHistorySchema.index({ createdAt: -1 });
walletHistorySchema.index({ email: 1, createdAt: -1 });
walletHistorySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("wallet_history", walletHistorySchema);
