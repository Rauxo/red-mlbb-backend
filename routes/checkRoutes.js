const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { 
  healthCheck, 
  bgmiCheck,
  mlbbCheck,
  genshinCheck 
} = require('../controllers/checkController');
const authMiddleware = require('../middlewares/checkMiddleware');

// Rate limiters
const bgmiLimiter = rateLimit({ windowMs: 60000, max: 20 });
const mlbbLimiter = rateLimit({ windowMs: 60000, max: 15 });
const genshinLimiter = rateLimit({ windowMs: 60000, max: 10 });

// Routes
router.get('/', healthCheck);
router.get('/username', authMiddleware, bgmiLimiter, bgmiCheck);
router.get('/mlbb-check', authMiddleware, mlbbLimiter, mlbbCheck);
router.get('/genshin-check', authMiddleware, genshinLimiter, genshinCheck);

module.exports = router;
