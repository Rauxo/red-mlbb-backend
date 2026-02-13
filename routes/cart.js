const express = require("express");
const router = express.Router();
const userModel = require("../models/userModel");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const qs = require("qs");
const axios = require("axios");
const fs = require("fs");
const nodemailer = require("nodemailer");
const paymentModel = require("../models/paymentModel");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderModel");
const paymentRequestModel = require("../models/paymentRequestModel");
const md5 = require("md5"); // Fixed: Default import
const crypto = require("crypto");
const base64 = require("base-64");
const querystring = require("querystring"); // Added: Missing import for SmileOne

// Add this near the top after imports
const yokcashHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Content-Type": "application/json",
  "Accept": "application/json"
};

const yokcash = axios.create({
  baseURL: "https://api.yokcash.com",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "WuruStore-Topup-Bot/1.0",
  },
});
// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};
const generateBasicAuthHeader = () => {
  const credentials = `${process.env.MOOGOLD_PARTNER_ID}:${process.env.MOOGOLD_SECRET}`;
  return `Basic ${base64.encode(credentials)}`;
};
const generateAuthSignature = (payload, timestamp, path) => {
  const stringToSign = `${JSON.stringify(payload)}${timestamp}${path}`;
  return crypto
    .createHmac("sha256", process.env.MOOGOLD_SECRET)
    .update(stringToSign)
    .digest("hex");
};

// Helper: Generate order ID
const generateOrderId = () => {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `${year}${month}${day}${hours}${minutes}${seconds}${randomNum}`;
};

// Moogold helpers (from old code) - Now accepts subOrderId
const placeMoogoldOrder = async (
  userid,
  zoneid,
  productid,
  amount,
  pname,
  gameName,
  subOrderId,
  customer_email,
  customer_mobile,
  txn_amount
) => {
  let payload;
  // Logic from old code for different games
  if (
    gameName === "428075" ||
    gameName === "9477186" ||
    gameName === "4233885" ||
    gameName === "8582211"
  ) {
    payload = {
      path: "order/create_order",
      data: {
        category: 1,
        "product-id": productid,
        quantity: 1,
        "User ID": userid,
        Server: zoneid,
      },
    };
  } else if (gameName === "4427071" || gameName === "4427073") {
    payload = {
      path: "order/create_order",
      data: {
        category: 1,
        "product-id": productid,
        quantity: 1,
        "Player Tag": userid,
      },
    };
  } else if (gameName === "6963") {
    payload = {
      path: "order/create_order",
      data: {
        category: 1,
        "product-id": productid,
        quantity: 1,
        "Character ID": userid,
      },
    };
  } else if (gameName === "5177311" || gameName === "2134118") {
    payload = {
      path: "order/create_order",
      data: {
        category: 1,
        "product-id": productid,
        quantity: 1,
        "Player ID": userid,
      },
    };
  } else {
    payload = {
      path: "order/create_order",
      data: {
        category: 1,
        "product-id": productid,
        quantity: 1,
        "User ID": userid,
        "Server ID": zoneid,
        fields: [userid, zoneid],
      },
    };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const path = "order/create_order";
  const authSignature = generateAuthSignature(payload, timestamp, path);

  const response = await axios.post(
    "https://moogold.com/wp-json/v1/api/order/create_order",
    payload,
    {
      headers: {
        Authorization: generateBasicAuthHeader(),
        auth: authSignature,
        timestamp: timestamp,
      },
    }
  );

  console.log(`Moogold API Response for ${pname}:`, response.data); // Added logging for debugging delivery

  if (response.status === 200 && response.data.status) {
    // Check for success status
    const order = new orderModel({
      api: "yes",
      productinfo: pname,
      orderDetails: amount,
      amount: txn_amount,
      orderId: subOrderId, // Use unique subOrderId
      email: customer_email,
      mobile: customer_mobile,
      userId: userid,
      zoneId: zoneid,
      status: "success",
    });
    await order.save();
  } else {
    throw new Error(
      `Moogold order failed: ${response.data?.message || "Unknown error"}`
    );
  }

  return response.data;
};

// SmileOne helpers (from old code) - Now accepts subOrderId
const placeSmileOneOrder = async (
  userid,
  zoneid,
  productids,
  product,
  region,
  subOrderId,
  customer_email,
  customer_mobile,
  txn_amount,
  amount,
  pname
) => {
  const uid = process.env.UID;
  const email = process.env.EMAIL;
  const time = Math.floor(Date.now() / 1000);
  const mKey = process.env.KEY;

  const apiUrl =
    region === "brazil"
      ? "https://www.smile.one/br/smilecoin/api/createorder"
      : "https://www.smile.one/ph/smilecoin/api/createorder";

  for (let i = 0; i < productids.length; i++) {
    const signArr = {
      uid,
      email,
      product: product.gameType || "mobilelegends",
      time,
      userid,
      zoneid,
      productid: productids[i],
    };

    const sortedSignArr = Object.fromEntries(Object.entries(signArr).sort());
    const str =
      Object.keys(sortedSignArr)
        .map((key) => `${key}=${sortedSignArr[key]}`)
        .join("&") +
      "&" +
      mKey;
    const sign = md5(md5(str));

    const formData = querystring.stringify({
      email,
      uid,
      userid,
      zoneid,
      product: product.gameType || "mobilelegends",
      productid: productids[i],
      time,
      sign,
    });

    const orderResponse = await axios.post(apiUrl, formData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    console.log(
      `SmileOne API Response for ${pname} (productid ${productids[i]}):`,
      orderResponse.data
    ); // Added logging

    if (!orderResponse.data || orderResponse.data.status !== 200) {
      throw new Error(
        `Smile.One recharge failed for productId ${productids[i]}: ${
          orderResponse.data?.message || "Unknown error"
        }`
      );
    }
  }

  // Save order (single for multiple products)
  const order = new orderModel({
    api: "yes",
    productinfo: pname,
    orderDetails: amount,
    amount: txn_amount,
    orderId: subOrderId, // Use unique subOrderId
    email: customer_email,
    mobile: customer_mobile,
    userId: userid,
    zoneId: zoneid,
    status: "success",
  });
  await order.save();
};

const placeYokcashOrder = async (
  userid,
  zoneid,
  productid,
  subOrderId,
  customer_mobile,
  customer_email,
  txn_amount,
  amount,
  pname
) => {
  let kontak = customer_mobile;
  if (!kontak.startsWith("+91")) {
    kontak = "+91" + kontak;
  }

  const API_KEY = process.env.YOK_API_KEY;
  const url = "https://api.yokcash.com/order";

  // CHANGED: Use JSON object instead of URLSearchParams
  const requestBody = {
    api_key: API_KEY,
    service_id: productid,
    target: `${userid}|${zoneid}`,
    kontak: kontak,
    idtrx: subOrderId,
    callback: "https://wurustore.in/api/yokcash/callback" // ADD YOUR CALLBACK URL
  };

  console.log(`Yokcash API Request for ${pname}:`, requestBody);

  const response = await axios.post(url, requestBody, {
    headers: {
      ...yokcashHeaders, // Make sure this is defined or use:
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    timeout: 30000,
  });

  console.log(`Yokcash API Response for ${pname}:`, response.data);

  if (!response.data.status) {
    throw new Error(response.data.msg || "Yokcash order failed");
  }

  const order = new orderModel({
    api: "yes",
    productinfo: pname,
    orderDetails: amount,
    amount: txn_amount,
    orderId: subOrderId,
    email: customer_email,
    mobile: customer_mobile,
    userId: userid,
    zoneId: zoneid,
    status: "pending", // CHANGED: Set to pending initially (will update via callback)
  });
  await order.save();

  return response.data;
};
// Updated generic placeOrder function to properly extract details
const placeOrder = async (
  apiName,
  item,
  orderId,
  subOrderId,
  customer_email,
  customer_mobile,
  txn_amount
) => {
  console.log("Processing order for item:", JSON.stringify(item, null, 2));

  // Extract userid and zoneid from cart item structure
  const userid = item.details?.userId || item.details?.userid;
  const zoneid = item.details?.zoneId || item.details?.zoneid;

  if (!userid || !zoneid) {
    console.error("Missing userid or zoneid in item:", item);
    throw new Error(`Missing user ID or zone ID for ${item.productName}`);
  }

  const { amount, id: productid, price } = item.pack;
  const pname = item.productName;

  const product = await productModel.findById(item.productId);
  if (!product) throw new Error(`Product not found: ${item.productId}`);

  console.log(`Placing ${apiName} order:`, {
    userid,
    zoneid,
    productid,
    pname,
    amount,
    subOrderId,
  });

  if (apiName === "moogold") {
    const gameNameOrProduct = product.gameName;
    return placeMoogoldOrder(
      userid,
      zoneid,
      productid,
      amount,
      pname,
      gameNameOrProduct,
      subOrderId,
      customer_email,
      customer_mobile,
      price
    );
  } else if (apiName === "smileOne") {
    const productids = productid.split("&");
    const region = product.region || "philliphines";
    return placeSmileOneOrder(
      userid,
      zoneid,
      productids,
      product,
      region,
      subOrderId,
      customer_email,
      customer_mobile,
      price,
      amount,
      pname
    );
  } else if (apiName === "yokcash") {
    return placeYokcashOrder(
      userid,
      zoneid,
      productid,
      subOrderId,
      customer_mobile,
      customer_email,
      price,
      amount,
      pname
    );
  } else {
    throw new Error(`Unsupported API: ${apiName}`);
  }
};

// Send order email helper - Fixed nodemailer
const sendOrderEmail = async (
  orderId,
  customer_email,
  totalAmount,
  cartItems
) => {
  try {
    let htmlContent = fs.readFileSync("order.html", "utf8");
    // Customize for cart: list items
    let itemsHtml = cartItems
      .map((item) => `<p>${item.productName} - ₹${item.pack.price}</p>`)
      .join("");
    htmlContent = htmlContent
      .replace("{orderId}", orderId)
      .replace("{amount}", totalAmount)
      .replace("{items}", itemsHtml)
      .replace(/{userId}/g, cartItems[0]?.details.userId || "")
      .replace(/{zoneId}/g, cartItems[0]?.details.zoneId || "");
    let mailTransporter = nodemailer.createTransport({
      // Fixed: createTransport
      service: "gmail",
      auth: {
        user: process.env.SENDING_EMAIL,
        pass: process.env.MAIL_PASS,
      },
    });
    await mailTransporter.sendMail({
      from: process.env.SENDING_EMAIL,
      to: customer_email,
      subject: "Cart Orders Successful!",
      html: htmlContent,
    });
  } catch (error) {
    console.error("Error sending cart email:", error);
  }
};

// Existing routes
router.post("/add", authenticateToken, async (req, res) => {
  try {
    const { cartItem } = req.body;
    const user = await userModel.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    // Validate details before adding (similar to product validation)
    // Assuming validation done in frontend, but add basic check
    if (!cartItem.details.userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID required" });
    }

    cartItem.timestamp = new Date().toISOString();
    user.cart.push(cartItem);
    await user.save();

    res.json({ success: true, message: "Added to cart" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/", authenticateToken, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.id).select("cart");
    res.json({ success: true, cart: user.cart });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/remove/:itemId", authenticateToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    console.log("Removing cart item with ID:", itemId);
    
    const user = await userModel.findById(req.user.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    console.log("User cart before removal:", user.cart.length, "items");
    
    // Log all cart item IDs for debugging
    user.cart.forEach((item, index) => {
      console.log(`Item ${index}:`, {
        _id: item._id,
        productName: item.productName,
        _idString: item._id ? item._id.toString() : 'no _id'
      });
    });

    // Remove the item
    const initialLength = user.cart.length;
    user.cart = user.cart.filter(item => 
      item._id && item._id.toString() !== itemId
    );
    
    console.log("Removed", initialLength - user.cart.length, "items");
    
    await user.save();

    res.json({ success: true, message: "Removed from cart" });
  } catch (error) {
    console.error("Remove cart item error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});
// In /api/cart/create-upi-order
router.post("/create-upi-order", authenticateToken, async (req, res) => {
  try {
    const user = await userModel
      .findById(req.user.id)
      .select("cart email mobile fname");
    if (!user || user.cart.length === 0) {
      return res.status(400).json({ success: false, message: "Cart empty" });
    }

    const orderId = generateOrderId();
    const totalAmount = user.cart.reduce(
      (sum, item) => sum + parseFloat(item.pack.price),
      0
    );

    // 🚨 CRITICAL CHANGE: Save cart directly, don't put in txn_note
    const paymentRequest = new paymentRequestModel({
      orderId,
      orderType: "cart", // ✅ Changed from "cart" to "cart" (same, but explicit)
      cart: user.cart,   // ✅ Save the actual cart array
      customer_email: user.email,
      customer_mobile: user.mobile,
      txn_amount: totalAmount.toString(),
      product_name: "Cart Purchase",
      customer_name: user.fname,
      status: "pending",
    });
    await paymentRequest.save();

    // Create UPI order
    const upiOrder = qs.stringify({
      customer_mobile: user.mobile,
      user_token: process.env.API_TOKEN,
      amount: totalAmount,
      order_id: orderId,
      redirect_url: `https://wurustore.in/user-dashboard`,
    });

    const config = {
      method: "post",
      url: "https://expay1.com/api/create-order",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: upiOrder,
    };

    const response = await axios.request(config);
    if (response.data && response.data.status === true) {
      res.json({ success: true, data: response.data, orderId });
    } else {
      await paymentRequest.deleteOne();
      res.status(500).json({ success: false, message: "Failed to create UPI order" });
    }
  } catch (error) {
    console.error("Create Cart UPI Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});


 router.post("/checkout-wallet", authenticateToken, async (req, res) => {
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const user = await userModel.findById(req.user.id).session(session);
    if (!user || user.cart.length === 0) {
      throw new Error("Cart empty");
    }

    const cartCopy = [...user.cart];
    const totalAmount = cartCopy.reduce(
      (sum, item) => sum + parseFloat(item.pack.price),
      0
    );
    
    if (user.balance < totalAmount) {
      throw new Error("Insufficient balance");
    }

    const orderId = generateOrderId();

    // Process recharges and save to orders collection
    let failures = [];
    for (let i = 0; i < cartCopy.length; i++) {
      const item = cartCopy[i];
      const subOrderId = `${orderId}-${i}`;
      try {
        await placeOrder(
          item.apiName,
          item,
          orderId,
          subOrderId,
          user.email,
          user.mobile,
          item.pack.price
        );
      } catch (err) {
        console.error(`Wallet recharge failed for ${item.productName}:`, err);
        failures.push(item.productName);
      }
    }

    // Deduct balance AFTER successful recharges
    user.balance -= totalAmount;
    
    // Add any rewards
    let totalReward = 0;
    for (const item of cartCopy) {
      const product = await productModel.findById(item.productId).session(session);
      const costItem = product?.cost.find((c) => c.amount === item.pack.amount);
      if (costItem?.reward) totalReward += parseFloat(costItem.reward);
    }
    user.balance += totalReward;
    
    // Clear cart
    user.cart = [];
    await user.save({ session });

    // Save payment record
    const payment = new paymentModel({
      name: user.fname,
      email: user.email,
      mobile: user.mobile,
      amount: totalAmount,
      orderId,
      status: "SUCCESS",
      utrNumber: `WALLET-${orderId}`,
      rewardAmount: totalReward,
      type: "cart_purchase",
      createdAt: new Date(),
    });
    await payment.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Send email
    await sendOrderEmail(orderId, user.email, totalAmount, cartCopy);

    if (failures.length > 0) {
      return res.json({
        success: true,
        message: `Processed with failures: ${failures.join(", ")}`,
        newBalance: user.balance,
      });
    }

    res.json({
      success: true,
      message: "Checkout successful",
      newBalance: user.balance,
    });
  } catch (error) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error("Wallet Checkout Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});


module.exports = router;