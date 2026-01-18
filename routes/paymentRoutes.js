const express = require("express");
const qs = require("qs");
const axios = require("axios");
const paymentModel = require("../models/paymentModel");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderModel");
const paymentRequestModel = require("../models/paymentRequestModel");
const sendMail = require("../controllers/sendMail");
const md5 = require("md5");
const crypto = require("crypto");
const querystring = require("querystring");
const authMiddleware = require("../middlewares/authMiddleware");
const router = express.Router();
const fs = require("fs");
const base64 = require("base-64");
const nodemailer = require("nodemailer");
const browserMiddleware = require("../middlewares/browserMiddleware");
const adminAuthMiddleware = require("../middlewares/adminAuthMiddleware");
const userModel = require("../models/userModel");


const yokcashHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Content-Type": "application/json",
  "Accept": "application/json"
};

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

// router.post("/place-order-from-wallet", authMiddleware, async (req, res) => {
//   try {
//     const {
//       orderId,
//       userid,
//       zoneid,
//       productid,
//       region,
//       customer_email,
//       customer_mobile,
//       pname,
//       amount,
//       price,
//       gameType, // <-- Accept gameType
//     } = req.body;

//     // Validate required fields
//     if (
//       !orderId ||
//       !userid ||
//       !zoneid ||
//       !productid ||
//       !region ||
//       !customer_email
//     ) {
//       return res
//         .status(400)
//         .send({ success: false, message: "Missing required fields" });
//     }

//     // Check user balance
//     const user = await userModel.findOne({ email: customer_email });
//     if (!user) {
//       return res
//         .status(404)
//         .send({ success: false, message: "User not found" });
//     }
//     if (user.balance < price) {
//       return res
//         .status(400)
//         .send({ success: false, message: "Insufficient balance" });
//     }

//     // Check for existing order
//     const existingOrder = await orderModel.findOne({ orderId });
//     if (existingOrder) {
//       return res
//         .status(400)
//         .send({ success: false, message: "Order already exists" });
//     }

//     // Use the provided gameType (or fallback to "mobilelegends" for backward compatibility)
//     const product = gameType || "mobilelegends";
//     const productIds = productid.split("&");
//     const uid = process.env.UID;
//     const email = process.env.EMAIL;
//     const mKey = process.env.KEY;

//     // Process each product ID with SmileOne API
//     for (const pid of productIds) {
//       const time = Math.floor(Date.now() / 1000);
//       const signArr = {
//         uid,
//         email,
//         product,
//         time,
//         userid,
//         zoneid,
//         productid: pid,
//       };
//       const sortedSignArr = Object.fromEntries(Object.entries(signArr).sort());
//       const signStr =
//         Object.keys(sortedSignArr)
//           .map((key) => `${key}=${sortedSignArr[key]}`)
//           .join("&") + `&${mKey}`;
//       const sign = md5(md5(signStr));
//       const formData = querystring.stringify({ ...signArr, sign });

//       const apiUrl =
//         region === "brazil"
//           ? "https://www.smile.one/br/smilecoin/api/createorder"
//           : "https://www.smile.one/ph/smilecoin/api/createorder";

//       await axios.post(apiUrl, formData, {
//         headers: { "Content-Type": "application/x-www-form-urlencoded" },
//       });
//     }
//     // Get the reward amount from the product
//     const Rproduct = await productModel.findOne({ name: pname });
//     const costItem = Rproduct.cost.find((item) => item.amount === amount);
//     const rewardAmount = costItem.reward || 0; // Get reward amount, default to 0 if not exists

//     // Deduct balance
//     user.balance -= price;
//     // Add reward to balance
//     user.balance += parseFloat(rewardAmount);
//     await user.save();

//     // Create order record
//     const newOrder = new orderModel({
//       api: "yes",
//       orderDetails: amount,
//       orderId,
//       productinfo: pname,
//       amount: price,
//       email: customer_email,
//       mobile: customer_mobile,
//       userId: userid,
//       zoneId: zoneid,
//       status: "success",
//       product: product, // <-- Store gameType/product
//     });
//     await newOrder.save();

//     // Create payment record
//     const newPayment = new paymentModel({
//       name: user.fname,
//       email: customer_email,
//       mobile: customer_mobile,
//       amount: price,
//       orderId,
//       status: "SUCCESS",
//       utrNumber: `WALLET-${Date.now()}`,
//       product: product, // <-- Store gameType/product
//     });
//     await newPayment.save();

//     // Send confirmation email
//     try {
//       const dynamicData = {
//         orderId,
//         amount,
//         price,
//         p_info: pname,
//         userId: userid,
//         zoneId: zoneid,
//         gameType: product, // <-- Include gameType/product in mail template, optional
//       };

//       let htmlContent = fs.readFileSync("order.html", "utf8");
//       Object.keys(dynamicData).forEach((key) => {
//         htmlContent = htmlContent.replace(
//           new RegExp(`{${key}}`, "g"),
//           dynamicData[key]
//         );
//       });

//       const transporter = nodemailer.createTransport({
//         service: "gmail",
//         auth: {
//           user: process.env.SENDING_EMAIL,
//           pass: process.env.MAIL_PASS,
//         },
//       });

//       await transporter.sendMail({
//         from: process.env.SENDING_EMAIL,
//         to: customer_email,
//         subject: "Order Successful!",
//         html: htmlContent,
//       });
//     } catch (emailError) {
//       console.error("Email sending failed:", emailError);
//     }

//     res.status(200).send({
//       success: true,
//       message: "Order placed successfully using wallet balance",
//     });
//   } catch (error) {
//     console.error("Wallet order error:", error);
//     res.status(500).send({
//       success: false,
//       message: error.response?.data?.message || error.message,
//     });
//   }
// });
router.post("/get-role", browserMiddleware, async (req, res) => {
  try {
    const { userid, zoneid, apiName, productId } = req.body;
    console.log("Received get-role request:", { userid, zoneid, productId });

    const uid = process.env.UID;
    const email = process.env.EMAIL;
    const time = Math.floor(Date.now() / 1000);
    const mKey = process.env.KEY;

    // Default to Mobile Legends Philippines with ID 212
    let product = "mobilelegends";
    let region = "philliphines";
    let smileProductId = "212";

    // Only process Magic Chess if we have a product ID and it's explicitly Magic Chess
    if (productId) {
      // Find the product in our database
      const productData = await productModel.findById(productId);

      if (productData && productData.gameType === "magicchessgogo") {
        console.log("Magic Chess product detected:", {
          name: productData.name,
          gameType: productData.gameType,
          region: productData.region,
        });

        // Switch to Magic Chess Go Go
        product = "magicchessgogo";
        region = "brazil";
        smileProductId = "23837";
      }
    }

    console.log("Final parameters:", {
      product,
      region,
      smileProductId,
    });

    // GENERATING SIGN
    const signArr = {
      uid,
      email,
      product,
      time,
      userid,
      zoneid,
      productid: smileProductId,
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
      product,
      productid: smileProductId,
      time,
      sign,
    });

    let apiUrl;
    if (region === "brazil") {
      apiUrl = "https://www.smile.one/br/smilecoin/api/getrole";
    } else {
      apiUrl = "https://www.smile.one/ph/smilecoin/api/getrole";
    }

    console.log("Calling Smile.one API:", apiUrl);

    let role;
    role = await axios.post(apiUrl, formData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (role.data.status === 200) {
      return res.status(200).send({
        success: true,
        username: role.data.username,
        zone: role.data.zone,
        message: role.data.message,
      });
    } else {
      return res
        .status(201)
        .send({ success: false, message: role.data.message });
    }
  } catch (error) {
    console.error("Error in /get-role:", error);
    return res.status(500).send({
      success: false,
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});
router.post("/get-user-payments", browserMiddleware, async (req, res) => {
  try {
    const payments = await paymentModel.find({ email: req.body.email });
    if (payments.length === 0) {
      return res
        .status(201)
        .send({ success: true, message: "No Payment Found" });
    }
    return res.status(200).send({
      success: true,
      message: "Payment Fetched successfully",
      data: payments,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});
router.get("/get-all-payments", adminAuthMiddleware, async (req, res) => {
  try {
    const payments = await paymentModel.find({});
    if (payments.length === 0) {
      return res
        .status(201)
        .send({ success: true, message: "No Payment Found" });
    }
    return res.status(200).send({
      success: true,
      message: "Payment Fetched successfully",
      data: payments,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

async function sendOrderEmail(dynamicData, customer_email) {
  try {
    let htmlContent = fs.readFileSync("order.html", "utf8");
    Object.keys(dynamicData).forEach((key) => {
      const placeholder = new RegExp(`{${key}}`, "g");
      htmlContent = htmlContent.replace(placeholder, dynamicData[key]);
    });

    let mailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SENDING_EMAIL,
        pass: process.env.MAIL_PASS,
      },
    });

    let mailDetails = {
      from: process.env.SENDING_EMAIL,
      to: customer_email,
      subject: "Order Successful!",
      html: htmlContent,
    };

    await mailTransporter.sendMail(mailDetails);
  } catch (error) {
    console.error("Error sending order email:", error);
  }
}

// --- Route: Create API UPI order ---
router.post("/create-api-upi-order", authMiddleware, async (req, res) => {
  try {
    const {
      order_id,
      txn_amount,
      txn_note,
      product_name,
      customer_name,
      customer_email,
      customer_mobile,
      callback_url,
    } = req.body;

    console.log("Creating UPI order:", {
      order_id,
      txn_amount,
      txn_note,
      product_name,
      customer_email,
    });

    if (!txn_note) {
      return res.status(400).json({ message: "Transaction note is required" });
    }

    const txnNoteParts = txn_note.split("@");
    if (txnNoteParts.length < 5) {
      return res.status(400).json({ message: "Invalid txn_note format" });
    }

    const pname = txnNoteParts[3];
    const amount = txnNoteParts[4];

    // Validate product for product orders
    let product;
    if (product_name) {
      product = await productModel.findOne({ name: pname });
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      // Validate txn_amount matches product cost
      const priceExists = product.cost.some(
        (item) =>
          item.amount === amount &&
          (parseFloat(item.price) === parseFloat(txn_amount) ||
            parseFloat(item.resPrice) === parseFloat(txn_amount))
      );
      if (!priceExists) {
        return res
          .status(400)
          .json({ message: "Amount does not match product price" });
      }
    }

    // Prevent duplicate orders
    const existingOrder = await orderModel.findOne({ orderId: order_id });
    if (existingOrder) {
      return res.redirect("https://wurustore.in/user-dashboard");
    }

    // Save payment request with pending status
    const paymentRequest = new paymentRequestModel({
      orderId: order_id,
      orderType: product_name ? "product" : "membership",
      txn_note,
      customer_email,
      customer_mobile,
      txn_amount,
      product_name,
      customer_name,
      status: "pending",
    });
    await paymentRequest.save();

    // Prepare UPI order request for payment gateway
    const upi_order = qs.stringify({
      customer_mobile,
      user_token: process.env.API_TOKEN, // CHANGED from API_TOKEN
      amount: txn_amount,
      order_id,
      redirect_url: callback_url,
    });

    // Call external payment gateway to create order
    const payment_gateway_url = "https://expay1.com/api/create-order";
    const config = {
      method: "post",
      maxBodyLength: Infinity,
      url: payment_gateway_url,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: upi_order,
    };

    console.log("Calling ExPay API with:", upi_order);

    const response = await axios.request(config);

    console.log("ExPay API response:", response.data);

    if (response.data && response.data.status === true) {
      return res.status(200).send({
        success: true,
        message: "Order created successfully",
        data: response.data,
      });
    }

    return res.status(500).json({
      error: "Payment gateway error",
      details: response.data,
    });
  } catch (error) {
    console.error(
      "Create API UPI Order Error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
});


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

router.post("/wallet/webhook", async (req, res) => {
  try {
    console.log("=== WEBHOOK RECEIVED ===");

    // Get raw body for signature verification
    const rawBody = req.rawBody || req.body;

    // Verify webhook signature
    const ts = req.get("x-expay-timestamp") || "";
    const sig = req.get("x-expay-signature") || "";

    console.log("Webhook headers:", { ts, sig });
    console.log("Webhook body:", req.body);

    if (!ts || !sig) {
      console.error("Missing webhook headers");
      return res.status(400).send("Missing headers");
    }

    // Calculate expected signature
    const expected = crypto
      .createHmac("sha256", process.env.EXPAY_WEBHOOK_SECRET)
      .update(`${ts}.${rawBody}`)
      .digest("hex");

    console.log("Expected signature:", expected);
    console.log("Received signature:", sig);

    if (!sig.includes(`v1=${expected}`)) {
      console.error("Invalid webhook signature");
      return res.status(400).send("Invalid signature");
    }

    const { orderId, status, utr, amount, event } = req.body;

    console.log(`Processing webhook:`, {
      orderId,
      status,
      event,
      utr,
      amount,
    });

    // Only process SUCCESS status
    if (status !== "SUCCESS") {
      console.log(`Ignoring non-success status: ${status}`);
      return res.status(200).send("OK - Ignored");
    }

    // PREVENT DOUBLE PROCESSING
    const existingPayment = await paymentModel.findOne({ orderId });
    if (existingPayment) {
      console.log(`Order ${orderId} already processed`);
      return res.status(200).send("Already processed");
    }

    // Find payment request
    const paymentRequest = await paymentRequestModel.findOne({ orderId });
    if (!paymentRequest) {
      console.error(`No payment request found for order: ${orderId}`);
      return res.status(200).send("No payment request found");
    }

    if (paymentRequest.status === "completed") {
      console.log(`Payment request already completed for order: ${orderId}`);
      return res.status(200).send("Already completed");
    }
    if (paymentRequest.type === "balance") {
      console.log("Processing BALANCE webhook:", orderId);

      const user = await userModel.findOne({
        email: paymentRequest.customer_email,
      });

      if (!user) {
        throw new Error("User not found for balance credit");
      }

      const addAmount = parseFloat(paymentRequest.txn_amount);
      const previousBalance = user.balance;

      // 🔥 ADD BALANCE
      user.balance += addAmount;
      await user.save();

      // 🔥 SAVE PAYMENT RECORD
      await paymentModel.create({
        orderId,
        name: paymentRequest.customer_name,
        email: paymentRequest.customer_email,
        mobile: paymentRequest.customer_mobile,
        amount: addAmount,
        status: "SUCCESS",
        utrNumber: utr,
        type: "balance_addition",
      });

      // 🔥 SAVE ORDER RECORD (CONSISTENCY)
      await orderModel.create({
        api: "no",
        orderId,
        productinfo: "Wallet Balance",
        orderDetails: `${addAmount} coins added`,
        amount: addAmount,
        email: paymentRequest.customer_email,
        mobile: paymentRequest.customer_mobile,
        status: "success",
        type: "balance_addition",
      });

      // 🔥 MARK COMPLETED
      paymentRequest.status = "completed";
      await paymentRequest.save();

      console.log(`Balance updated: ${previousBalance} → ${user.balance}`);

      // 🔥 IMPORTANT: STOP EXECUTION HERE
      return res.status(200).send("Balance credited successfully");
    }
    if (paymentRequest.orderType === "cart") {
  console.log("Processing CART webhook:", orderId);
  
  const user = await userModel.findOne({
    email: paymentRequest.customer_email
  });

  if (!user) {
    console.error("User not found for cart order");
    return res.status(200).send("User not found");
  }

  let failures = [];
  
  // Process each cart item
  for (let i = 0; i < paymentRequest.cart.length; i++) {
    const item = paymentRequest.cart[i];
    const subOrderId = `${orderId}-${i}`;
    
    try {
      // Use the same placeOrder function from cart.js
      await placeOrder(
        item.apiName,
        item,
        orderId,
        subOrderId,
        paymentRequest.customer_email,
        paymentRequest.customer_mobile,
        item.pack.price
      );
      console.log(`Cart item ${i} processed: ${item.productName}`);
    } catch (err) {
      console.error(`Cart recharge failed for ${item.productName}:`, err);
      failures.push(item.productName);
    }
  }

  // Clear user's cart
  user.cart = [];
  await user.save();

  // Mark payment request as completed
  paymentRequest.status = "completed";
  await paymentRequest.save();

  // Save payment record
  await paymentModel.create({
    orderId,
    name: paymentRequest.customer_name,
    email: paymentRequest.customer_email,
    mobile: paymentRequest.customer_mobile,
    amount: paymentRequest.txn_amount,
    status: "SUCCESS",
    utrNumber: utr,
    type: "cart_purchase",
  });

  if (failures.length > 0) {
    console.log(`Cart processed with failures: ${failures.join(", ")}`);
    return res.status(200).send(`Cart processed with some failures: ${failures.join(", ")}`);
  }

  console.log(`Cart order ${orderId} fully processed`);
  return res.status(200).send("Cart recharge completed successfully");
}

    console.log(
      `Processing order: ${orderId} for ${paymentRequest.customer_email}`
    );
    console.log(`TXN Note: ${paymentRequest.txn_note}`);

    // Mark as processing
    paymentRequest.status = "processing";
    await paymentRequest.save();

    // Parse txn_note
    const txnNote = paymentRequest.txn_note;
    let userId, zoneId, productIds, productName, packAmount;

    if (txnNote.includes("@")) {
      const parts = txnNote.split("@");
      if (parts.length >= 5) {
        [userId, zoneId, productIds, productName, packAmount] = parts;
      } else {
        throw new Error(`Invalid txn_note format: ${txnNote}`);
      }
    } else {
      throw new Error(`Unknown txn_note format: ${txnNote}`);
    }

    // Find product
    const product = await productModel.findOne({ name: productName });
    if (!product) {
      throw new Error(`Product not found: ${productName}`);
    }

    console.log(
      `Processing for product: ${productName}, API: ${product.apiName}`
    );

    // Process based on API
    let rechargeResult;
    if (product.apiName === "smileOne") {
      rechargeResult = await processSmileOneRecharge(
        userId,
        zoneId,
        productIds,
        product,
        packAmount,
        paymentRequest
      );
    } else if (product.apiName === "moogold") {
      rechargeResult = await processMoogoldRecharge(
        userId,
        zoneId,
        productIds,
        product,
        paymentRequest
      );
    } else if (product.apiName === "yokcash") {
      rechargeResult = await processYokcashRecharge(
        userId,
        zoneId,
        productIds,
        product,
        paymentRequest
      );
    } else {
      throw new Error(`Unknown API: ${product.apiName}`);
    }

    console.log(`Recharge result:`, rechargeResult);

    // Save payment record
    await paymentModel.create({
      orderId,
      name: paymentRequest.customer_name,
      email: paymentRequest.customer_email,
      mobile: paymentRequest.customer_mobile,
      amount: paymentRequest.txn_amount,
      status: "SUCCESS",
      utrNumber: utr,
      createdAt: new Date(),
    });

    // Save order record
    await orderModel.create({
      api: "yes",
      orderId,
      productinfo: productName,
      amount: paymentRequest.txn_amount,
      email: paymentRequest.customer_email,
      mobile: paymentRequest.customer_mobile,
      userId: userId,
      zoneId: zoneId,
      status: "success",
      createdAt: new Date(),
    });

    // Mark as completed
    paymentRequest.status = "completed";
    await paymentRequest.save();

    // Send email
    try {
      await sendOrderEmail(
        {
          orderId,
          amount: packAmount,
          price: paymentRequest.txn_amount,
          p_info: productName,
          userId: userId,
          zoneId: zoneId,
        },
        paymentRequest.customer_email
      );
      console.log(`Email sent to ${paymentRequest.customer_email}`);
    } catch (emailError) {
      console.error("Error sending email:", emailError);
    }

    console.log(`Successfully processed order: ${orderId}`);
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook processing error:", error.message, error.stack);
    return res.status(500).send("Internal server error");
  }
});

// SmileOne recharge function
async function processSmileOneRecharge(
  userId,
  zoneId,
  productIdsStr,
  product,
  packAmount,
  paymentRequest
) {
  try {
    console.log("=== SMILEONE RECHARGE START ===");
    console.log("Parameters:", { userId, zoneId, productIdsStr, packAmount });
    const productIds = productIdsStr.split("&");
    const productType = product.gameType || "mobilelegends";
    const region = product.region || "philliphines";

    const uid = process.env.UID;
    const email = process.env.EMAIL;
    const key = process.env.KEY;
    const time = Math.floor(Date.now() / 1000);

    console.log(`Processing SmileOne recharge:`, {
      userId,
      zoneId,
      productIds,
      productType,
      region,
    });

    for (const productId of productIds) {
      const signStr =
        `email=${email}&product=${productType}&productid=${productId}` +
        `&time=${time}&uid=${uid}&userid=${userId}&zoneid=${zoneId}&${key}`;
      const sign = md5(md5(signStr));

      const formData = querystring.stringify({
        email,
        uid,
        userid: userId,
        zoneid: zoneId,
        product: productType,
        productid: productId,
        time,
        sign,
      });

      const apiUrl =
        region === "brazil"
          ? "https://www.smile.one/br/smilecoin/api/createorder"
          : "https://www.smile.one/ph/smilecoin/api/createorder";

      console.log(`Calling SmileOne API: ${apiUrl}`);

      const response = await axios.post(apiUrl, formData, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30000,
      });

      console.log(`SmileOne response for ${productId}:`, response.data);

      if (!response.data || response.data.status !== 200) {
        throw new Error(
          `SmileOne recharge failed: ${JSON.stringify(response.data)}`
        );
      }

      console.log(`SmileOne recharge successful for product ${productId}`);
    }
  } catch (error) {
    console.error("SmileOne recharge error:", error);
    throw error;
  }
}

// Moogold recharge function
async function processMoogoldRecharge(
  userId,
  zoneId,
  productId,
  product,
  paymentRequest
) {
  try {
    const gameName = product.gameName || "";
    let payload;
    console.log("=== MOOGOLD RECHARGE START ===");
    console.log(`Processing Moogold recharge for game: ${gameName}`);

    // Determine payload based on game
    if (["428075", "9477186", "4233885", "8582211"].includes(gameName)) {
      payload = {
        path: "order/create_order",
        data: {
          category: 1,
          "product-id": productId,
          quantity: 1,
          "User ID": userId,
          Server: zoneId,
        },
      };
    } else if (["4427071", "4427073"].includes(gameName)) {
      payload = {
        path: "order/create_order",
        data: {
          category: 1,
          "product-id": productId,
          quantity: 1,
          "Player Tag": userId,
        },
      };
    } else if (gameName === "6963") {
      payload = {
        path: "order/create_order",
        data: {
          category: 1,
          "product-id": productId,
          quantity: 1,
          "Character ID": userId,
        },
      };
    } else if (gameName === "2134118") {
      payload = {
        path: "order/create_order",
        data: {
          category: 1,
          "product-id": productId,
          quantity: 1,
          "Character ID": userId,
        },
      };
    } else if (gameName === "5177311") {
      payload = {
        path: "order/create_order",
        data: {
          category: 1,
          "product-id": productId,
          quantity: 1,
          "Player ID": userId,
        },
      };
    } else {
      payload = {
        path: "order/create_order",
        data: {
          category: 1,
          "product-id": productId,
          quantity: 1,
          "User ID": userId,
          "Server ID": zoneId,
          fields: [userId, zoneId],
        },
      };
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const authSignature = crypto
      .createHmac("sha256", process.env.MOOGOLD_SECRET)
      .update(`${JSON.stringify(payload)}${timestamp}order/create_order`)
      .digest("hex");

    const credentials = `${process.env.MOOGOLD_PARTNER_ID}:${process.env.MOOGOLD_SECRET}`;
    const basicAuth = Buffer.from(credentials).toString("base64");

    console.log("Calling Moogold API with payload:", payload);

    const response = await axios.post(
      "https://moogold.com/wp-json/v1/api/order/create_order",
      payload,
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          auth: authSignature,
          timestamp: timestamp,
        },
        timeout: 30000,
      }
    );

    console.log("Moogold API response:", response.data);

    if (!response.data) {
      throw new Error("Moogold empty response");
    }

    if (
      response.data.status !== "processing" &&
      response.data.status !== "completed"
    ) {
      throw new Error(
        `Moogold recharge failed: ${JSON.stringify(response.data)}`
      );
    }
    console.log("Moogold recharge successful");
  } catch (error) {
    console.error("Moogold recharge error:", error);
    throw error;
  }
}

// Yokcash recharge function
async function processYokcashRecharge(
  userId,
  zoneId,
  productId,
  product,
  paymentRequest
) {
  try {
    console.log(`Processing Yokcash recharge:`, {
      userId,
      zoneId,
      productId,
      mobile: paymentRequest.customer_mobile,
    });

    const yokcashHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://yokcash.com",
      Referer: "https://yokcash.com/",
    };

    const response = await axios.post(
      "https://api.yokcash.com/order",
      {
        api_key: process.env.YOK_API_KEY,
        service_id: productId,
        target: `${userId}|${zoneId}`,
        kontak: paymentRequest.customer_mobile,
        idtrx: paymentRequest.orderId,
        callback: "https://wurustore.in/api/yokcash/callback",
      },
      {
        headers: yokcashHeaders,
        timeout: 30000,
      }
    );

    console.log("Yokcash API response:", response.data);

    if (!response.data || !response.data.status) {
      throw new Error(
        `Yokcash recharge failed: ${JSON.stringify(response.data)}`
      );
    }

    console.log("Yokcash recharge successful");
  } catch (error) {
    console.error("Yokcash recharge error:", error);
    throw error;
  }
}

module.exports = router;
