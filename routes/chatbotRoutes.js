const express = require("express");
const { getQuestions, getAnswerById } = require("../controllers/chatbotController");

const router = express.Router();

router.get("/questions", getQuestions);
router.get("/answer/:id", getAnswerById);

module.exports = router;

