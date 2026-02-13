const { chatbotData } = require("./chatbotData.js");

// Get all questions
const getQuestions = (req, res) => {
  try {
    res.json(chatbotData);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get answer by question ID
const getAnswerById = (req, res) => {
  try {
    const { id } = req.params;
    const question = chatbotData.find(q => q.id == id);
    if (!question) {
      return res.json({ answer: "Sorry, I don’t have an answer for that." });
    }
    res.json({ answer: question.answer });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getQuestions,
  getAnswerById,
};

