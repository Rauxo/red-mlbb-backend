const express = require("express");
const multer = require("multer");
const fs = require("fs");
const adminAuthMiddleware = require("../middlewares/adminAuthMiddleware");

// router object
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "media/banner");
  },
  filename: (req, file, cb) => {
    cb(null, "banner-" + file.originalname );
  },
});

const adminImageUpload = multer({ storage: storage });

router.post('/add-banner', adminAuthMiddleware, adminImageUpload.single('image'), (req, res) => {
     res.send("file uploaded successfully")
}, (error, req, res, next) => {
     res.status(400).send({ error: error.message })
})

router.get("/", (req, res) => {
    res.send("API running..");
});

module.exports = router;
