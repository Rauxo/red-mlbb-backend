const express = require("express");
const multer = require("multer");
const Account = require("../models/accountModel");
const adminAuthMiddleware = require("../middlewares/adminAuthMiddleware");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Configure storage for account images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../accounts");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o775 });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "account-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

// Route to fetch all accounts (for public access)
router.get('/user', async (req, res) => {
  try {
    console.log('Request to /api/account/user:', req.url, req.params); // Debugging
    const accounts = await Account.find().sort({ createdAt: -1 });
    res.status(200).json(accounts);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch accounts',
      error: error.message,
    });
  }
});

// Route to fetch a single account by ID
router.get("/:id", async (req, res) => {
  try {
    console.log('Request to /api/account/:id:', req.params.id); // Debugging
    const account = await Account.findById(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }
    res.status(200).json({
      success: true,
      account,
    });
  } catch (error) {
    console.error("Error fetching account:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: "Invalid account ID format",
      });
    }
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});
// Add this PUT route for updating accounts
router.put(
  "/:id",
  adminAuthMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { description, price, status } = req.body;
      
      const updateData = {
        description,
        price: parseFloat(price),
        status: status || "on sale",
      };

      // Handle image update if new file exists
      if (req.file) {
        // Find existing account to delete old image
        const existingAccount = await Account.findById(id);
        if (existingAccount && existingAccount.image) {
          fs.unlink(existingAccount.image, (err) => {
            if (err) console.error("Error deleting old image:", err);
          });
        }
        updateData.image = req.file.path;
      }

      const updatedAccount = await Account.findByIdAndUpdate(
        id,
        updateData,
        { new: true }
      );

      if (!updatedAccount) {
        return res.status(404).json({
          success: false,
          message: "Account not found",
        });
      }

      res.json({
        success: true,
        message: "Account updated successfully",
        account: updatedAccount,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  }
);
// Route to fetch all accounts (for admin)
router.get('/', adminAuthMiddleware, async (req, res) => {
  try {
    const accounts = await Account.find().sort({ createdAt: -1 });
    res.status(200).json(accounts);
  } catch (error) {
    console.error("Error fetching accounts:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// Route to delete an account
router.delete('/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const accountId = req.params.id;
    const account = await Account.findById(accountId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Delete image file
    const imagePath = path.join(__dirname, '../accounts', account.image);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    // Delete from database
    await Account.findByIdAndDelete(accountId);

    res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// Route to add a new account
router.post(
  "/add",
  adminAuthMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      const { description, price , status } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No image uploaded",
        });
      }

      // Create new account
      const account = new Account({
        image: req.file.filename,
        description,
        price: parseFloat(price),
	status: status || "on sale", 
      });

      const savedAccount = await account.save();

      res.status(201).json({
        success: true,
        message: "Account added successfully",
        account: savedAccount,
        imageUrl: `/accounts/${req.file.filename}`,
      });
    } catch (error) {
      console.error("Account creation error:", error);
      res.status(500).json({
        success: false,
        message: "Server error",
        error: error.message,
      });
    }
  }
);

module.exports = router;
