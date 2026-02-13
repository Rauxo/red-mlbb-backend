// review.model.js
const mongoose = require("mongoose");
const ReviewSchema = new mongoose.Schema({
  email: { type: String, required: true },
  stars: { type: Number, required: true, min: 1, max: 5 },
  description: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model("Review", ReviewSchema);

