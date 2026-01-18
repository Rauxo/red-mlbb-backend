const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  isAdmin: { type: Boolean, default: false },

  email: {
    type: String,
    required: [true, "email is required"],
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },

  googleId: { type: String, default: "", trim: true, index: true },
  avatar: { type: String, default: "" },

  fname: { type: String, default: "", trim: true },

  mobile: {
    type: String,
    trim: true,
  },

  mobileLocked: { type: Boolean, default: false },
  mobileSetAt: { type: Date },

  balance: { type: Number, default: 0 },

  password: {
    type: String,
    required: [true, "password is required"],
  },

  otp: { type: String },
  emailOtp: { type: String },

  reseller: { type: String, default: "no" },
  mobileVerified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },

  block: { type: String, default: "no" },

  lastLogin: { type: Date },

  created: { type: Date, default: Date.now },

  cart: [
    {
      productId: { type: String, required: true },
      productName: { type: String, required: true },
      productImage: { type: String },
      apiName: { type: String },
      pack: {
        amount: { type: String, required: true },
        price: { type: String, required: true },
        id: { type: String },
      },
      details: {
        userId: { type: String },
        zoneId: { type: String },
        playerCheck: { type: String },
        playerId: { type: String },
      },
      timestamp: { type: Date, default: Date.now },
    },
  ],
});

userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { googleId: { $ne: "" } },
  }
);

const userModel = mongoose.model("users", userSchema);
module.exports = userModel;
