// routes/review.js
const express = require("express");
const router = express.Router();
const Review = require("../models/reviewModel");

// GET all reviews
router.get("/", async (req, res) => {
  const reviews = await Review.find().sort({ createdAt: -1 });
  res.json(reviews);
});

// POST new review
router.post("/", async (req, res) => {
  const { email, stars, description, createdAt } = req.body;
  if (!email || !stars || !description) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const review = new Review({ email, stars, description, createdAt });
  await review.save();
  res.json(review);
});

module.exports = router;

