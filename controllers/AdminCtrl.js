// controllers/AdminCtrl.js
const mongoose = require("mongoose");
const crypto = require("crypto");
const userModel = require("../models/userModel");
const orderModel = require("../models/orderModel");
const paymentModel = require("../models/paymentModel.js");
const walletHistoryModel = require("../models/walletHistoryModel");
const sendMail = require("./sendMail");


const PROTECTED_EMAILS = new Set(
  [process.env.CLIENT_EMAIL, "wuru495@gmail.com"]
    .filter(Boolean)
    .map((e) => String(e).toLowerCase().trim())
);

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

const getCurrentMonthSales = async (req, res) => {
  try {
    const now = new Date();

    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date();

    const result = await paymentModel.aggregate([
      {
        $match: {
          createdAt: {   // ✅ FIX HERE
            $gte: start,
            $lte: end,
          },
        },
      },
      {
        $addFields: {
          amountNumber: {
            $toDouble: { $ifNull: ["$amount", 0] },
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amountNumber" },
        },
      },
    ]);

    return res.status(200).send({
      success: true,
      month: now.toLocaleString("default", { month: "long" }),
      total: result.length ? result[0].total : 0,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({ success: false, message: error.message });
  }
};

function getDateRange(dateStr) {
  const start = new Date(dateStr);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid date format");
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function normalizeMobile(m) {
  return String(m || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\d+]/g, "");
}

function parseYesNo(v, field) {
  const s = String(v || "").toLowerCase();
  if (s !== "yes" && s !== "no") throw new Error(`${field} must be yes/no`);
  return s;
}

function parseBool(v, field) {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`${field} must be boolean`);
}

function getIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "");
  return (xf.split(",")[0] || req.socket.remoteAddress || "").trim();
}

function parseDelta(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("balanceDelta must be a number");
  const fixed = Math.round(n * 100) / 100;
  if (fixed === 0) throw new Error("balanceDelta cannot be 0");
  if (Math.abs(fixed) > 100000) throw new Error("balanceDelta too large");
  return fixed;
}

function sanitizeReason(v) {
  const r = String(v || "").trim();
  if (r.length < 3 || r.length > 120) throw new Error("Reason must be 3-120 chars");
  return r;
}

const adminAdjustUserBalanceController = async (req, res) => {
  try {
    const { _id, balanceDelta, reason } = req.body;

    if (!isValidObjectId(_id)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const delta = parseDelta(balanceDelta);
    const r = sanitizeReason(reason);

    const victim = await userModel.findById(_id).select("email block balance").lean();
    if (!victim) return res.status(404).json({ success: false, message: "User not found" });

    if (victim.block === "yes") {
      return res.status(403).json({ success: false, message: "User is blocked" });
    }

    if (PROTECTED_EMAILS.has(String(victim.email || "").toLowerCase())) {
      return res.status(403).json({ success: false, message: "Protected user cannot be modified" });
    }

    const before = Number(victim.balance || 0);

    if (delta < 0 && before + delta < 0) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance (cannot go negative)",
      });
    }

    const updated = await userModel.findOneAndUpdate(
      { _id, block: { $ne: "yes" } },
      { $inc: { balance: delta } },
      {
        new: true,
        projection: { password: 0, otp: 0, emailOtp: 0, googleId: 0, __v: 0 },
      }
    );

    if (!updated) {
      return res.status(500).json({ success: false, message: "Failed to update balance" });
    }

    const after = Number(updated.balance || 0);
    const txnId = "ADM-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");

    await walletHistoryModel.create({
      userId: updated._id,
      email: victim.email,
      amount: Math.abs(delta),
      type: delta > 0 ? "CREDIT" : "DEBIT",
      mode: "ADMIN_ADJUST",
      transaction_id: txnId,
      status: "SUCCESS",
      message: r,
      changedByAdmin: true,
      adminId: req.user?.id || null,
      ip: getIp(req),
      balanceBefore: before,
      balanceAfter: after,
    });

    return res.status(200).json({
      success: true,
      message: "Balance updated",
      data: {
        _id: updated._id,
        email: updated.email,
        balance: updated.balance,
        transaction_id: txnId,
      },
    });
  } catch (err) {
    console.error("adminAdjustUserBalanceController:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const adminGetWalletHistoryController = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1) - 1;
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);

    const search = String(req.query.search || "").trim(); 
    const type = String(req.query.type || "").trim().toUpperCase(); 
    const mode = String(req.query.mode || "").trim();
    const date = String(req.query.date || "").trim(); 

    const filter = {};
    if (search) filter.email = { $regex: search, $options: "i" };
    if (type === "CREDIT" || type === "DEBIT") filter.type = type;
    if (mode) filter.mode = mode;

    if (date) {
      const { start, end } = getDateRange(date);
      filter.createdAt = { $gte: start, $lt: end };
    }

    const rows = await walletHistoryModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean();

    const total = await walletHistoryModel.countDocuments(filter);

    return res.status(200).json({
      success: true,
      message: "Wallet history fetched",
      total,
      page: page + 1,
      limit,
      data: rows,
    });
  } catch (err) {
    console.error("adminGetWalletHistoryController:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


const getAllUserController = async (req, res) => {
  try {
    const users = await userModel
      .find({ email: { $nin: Array.from(PROTECTED_EMAILS) } })
      .select("-googleId -__v -otp -emailOtp -password")
      .lean();

    if (!users || users.length === 0) {
      return res.status(200).send({ success: false, message: "No User Found" });
    }

    return res.status(200).send({
      success: true,
      message: "All Users Fetched Successfully",
      data: users,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Get All User Ctrl ${error.message}`,
    });
  }
};

const getAllResellerUsersController = async (req, res) => {
  try {
    const resellers = await userModel
      .find({ reseller: "yes" })
      .select("-googleId -__v -otp -emailOtp -password")
      .lean();

    if (!resellers || resellers.length === 0) {
      return res.status(200).send({
        success: false,
        message: "No Reseller Users Found",
      });
    }

    return res.status(200).send({
      success: true,
      message: "Reseller Users Fetched Successfully",
      data: resellers,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Get Reseller Users Ctrl Error: ${error.message}`,
    });
  }
};

const getUserController = async (req, res) => {
  try {
    const { id } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).send({ success: false, message: "Invalid user id" });
    }

    const user = await userModel
      .findById(id)
      .select("-googleId -__v -otp -emailOtp -password")
      .lean();

    if (!user) {
      return res.status(200).send({ success: false, message: "No User Found" });
    }

    return res.status(200).send({
      success: true,
      message: "User Fetched Success",
      data: user,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Get User Ctrl ${error.message}`,
    });
  }
};

const deleteUserController = async (req, res) => {
  try {
    const { id } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).send({ success: false, message: "Invalid user id" });
    }

    const victim = await userModel.findById(id).select("email").lean();
    if (!victim) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    if (PROTECTED_EMAILS.has(String(victim.email || "").toLowerCase())) {
      return res.status(403).send({ success: false, message: "Protected user cannot be deleted" });
    }

    const deleted = await userModel.findOneAndDelete({ _id: id });
    if (!deleted) {
      return res.status(500).send({ success: false, message: "Failed to delete" });
    }

    return res.status(200).send({
      success: true,
      message: "User Deleted Successfully",
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Delete User Ctrl ${error.message}`,
    });
  }
};

const editUserController = async (req, res) => {
  try {
    const { _id } = req.body;

    if (!isValidObjectId(_id)) {
      return res.status(400).send({ success: false, message: "Invalid user id" });
    }

    const target = await userModel
      .findById(_id)
      .select("email mobile mobileLocked block")
      .lean();

    if (!target) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    if (target.block === "yes") {
      return res.status(403).send({ success: false, message: "Blocked user cannot be edited" });
    }

    if (PROTECTED_EMAILS.has(String(target.email || "").toLowerCase())) {
      return res.status(403).send({ success: false, message: "Protected user cannot be edited" });
    }

    if (
      req.body.email !== undefined ||
      req.body.googleId !== undefined ||
      req.body.password !== undefined ||
      req.body.isAdmin !== undefined ||
      req.body.balance !== undefined 
    ) {
      return res.status(400).send({ success: false, message: "Cannot edit sensitive fields" });
    }

    const updateData = {};

    if (req.body.fname !== undefined) {
      const name = String(req.body.fname || "").trim();
      if (name.length > 60) {
        return res.status(400).send({ success: false, message: "Name too long" });
      }
      updateData.fname = name;
    }

    if (req.body.reseller !== undefined) {
      updateData.reseller = parseYesNo(req.body.reseller, "reseller");
    }

    if (req.body.block !== undefined) {
      updateData.block = parseYesNo(req.body.block, "block");
    }

    if (req.body.mobileVerified !== undefined) {
      updateData.mobileVerified = parseBool(req.body.mobileVerified, "mobileVerified");
    }

    if (req.body.mobile !== undefined) {
      const m = normalizeMobile(req.body.mobile);

      if (!m || m.length < 8 || m.length > 16) {
        return res.status(400).send({ success: false, message: "Invalid mobile format" });
      }

      if (target.mobileLocked || (target.mobile && String(target.mobile).trim())) {
        return res.status(403).send({
          success: false,
          message: "Mobile is locked and cannot be changed",
        });
      }

      const exists = await userModel
        .findOne({ _id: { $ne: _id }, mobile: m })
        .select("_id")
        .lean();

      if (exists) {
        return res.status(409).send({ success: false, message: "Mobile already in use" });
      }

      updateData.mobile = m;
      updateData.mobileLocked = true;
      updateData.mobileSetAt = new Date();
      updateData.mobileVerified = true;
    }

    if (!Object.keys(updateData).length) {
      return res.status(400).send({ success: false, message: "Nothing to update" });
    }

    const updated = await userModel.findOneAndUpdate(
      { _id, block: { $ne: "yes" } },
      { $set: updateData },
      {
        new: true,
        projection: { password: 0, otp: 0, emailOtp: 0, googleId: 0, __v: 0 },
      }
    );

    return res.status(201).send({
      success: true,
      message: "User Updated Successfully",
      data: updated,
    });
  } catch (error) {
    console.error("editUserController:", error);
    return res.status(500).send({
      success: false,
      message: `Admin Edit User Ctrl ${error.message}`,
    });
  }
};


const sendMailToIncompleteUsersController = async (req, res) => {
  try {
    const { incompleteUsers, msg } = req.body;

    if (!Array.isArray(incompleteUsers) || !msg) {
      return res.status(400).send({ success: false, message: "Invalid request data" });
    }

    if (incompleteUsers.length > 500) {
      return res.status(400).send({ success: false, message: "Too many recipients" });
    }

    for (const u of incompleteUsers) {
      const email = String(u?.email || "").trim();
      if (!email) continue;
      await sendMail(email, "Incomplete Profile", "", msg);
    }

    return res.status(200).send({ success: true, message: "Emails sent to all users" });
  } catch (error) {
    console.error(`Send Mail to Incomplete Profiles Ctrl: ${error.message}`);
    return res.status(500).send({ success: false, message: "Internal Server Error" });
  }
};

const adminGetAllOrdersController = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1) - 1;
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const search = String(req.query.search || "").trim();
    const date = req.query.date ? String(req.query.date) : "";

    const sortRaw = String(req.query.sort || "createdAt,desc");
    const sortParts = sortRaw.split(",");
    const sortField = sortParts[0] || "createdAt";
    const sortDir = (sortParts[1] || "desc").toLowerCase() === "asc" ? 1 : -1;

    const filter = {};

    if (date) {
      const { start, end } = getDateRange(date);
      filter.createdAt = { $gte: start, $lt: end };
    }

    if (search) {
      filter.email = { $regex: search, $options: "i" };
    }

    const orders = await orderModel
      .find(filter)
      .sort({ [sortField]: sortDir })
      .skip(page * limit)
      .limit(limit)
      .lean();

    const total = await orderModel.countDocuments(filter);

    if (!orders || orders.length === 0) {
      return res.status(200).send({ success: false, message: "No Orders Found" });
    }

    const totalAmountAgg = await orderModel.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } },
      { $project: { _id: 0, total: 1 } },
    ]);

    return res.status(201).send({
      success: true,
      total,
      page: page + 1,
      limit,
      date,
      sort: [sortField, sortDir === 1 ? "asc" : "desc"],
      message: "All Orders Fetched Success",
      data: orders,
      totalAmount: totalAmountAgg.length > 0 ? totalAmountAgg[0].total : 0,
    });
  } catch (error) {
    console.error("adminGetAllOrdersController:", error);
    return res.status(500).send({
      success: false,
      message: `Admin Get All Order Ctrl ${error.message}`,
    });
  }
};

const adminUpdateOrderController = async (req, res) => {
  try {
    const { id, status } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).send({ success: false, message: "Invalid order id" });
    }

    const order = await orderModel.findById(id).lean();
    if (!order) {
      return res.status(200).send({ success: false, message: "No Order Found" });
    }

    const nextStatus = String(status || "").toLowerCase().trim();
    if (!nextStatus) {
      return res.status(400).send({ success: false, message: "Status is required" });
    }

    const updateOrder = await orderModel.findOneAndUpdate(
      { _id: id },
      { $set: { status: nextStatus } },
      { new: true }
    );

    if (!updateOrder) {
      return res.status(500).send({
        success: false,
        message: "Failed to update the order",
      });
    }

    const email = order.email;
    if (email) {
      const subject = "Order Completed Successfully!";
      const msg =
        "Your order has been successfully completed. Please login to see - www.topupplayground.com";
      await sendMail(email, subject, "", msg);
    }

    return res.status(202).send({
      success: true,
      message: "Order updated successfully",
      data: updateOrder,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: `Admin Update Order Ctrl ${error.message}`,
    });
  }
};

const getAllPaymentsController = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1) - 1;
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const search = String(req.query.search || "").trim();
    const date = req.query.date ? String(req.query.date) : "";

    const sortRaw = String(req.query.sort || "createdAt,desc");
    const sortParts = sortRaw.split(",");
    const sortField = sortParts[0] || "createdAt";
    const sortDir = (sortParts[1] || "desc").toLowerCase() === "asc" ? 1 : -1;

    const filter = {};

    if (date) {
      const { start, end } = getDateRange(date);
      filter.createdAt = { $gte: start, $lt: end };
    }

    if (search) {
      filter.email = { $regex: search, $options: "i" };
    }

    const payments = await paymentModel
      .find(filter)
      .sort({ [sortField]: sortDir })
      .skip(page * limit)
      .limit(limit)
      .lean();

    const total = await paymentModel.countDocuments(filter);

    if (!payments || payments.length === 0) {
      return res.status(201).send({ success: true, message: "No Payment Found" });
    }

    return res.status(200).send({
      success: true,
      message: "Payment Fetched successfully",
      total,
      page: page + 1,
      limit,
      date,
      sort: [sortField, sortDir === 1 ? "asc" : "desc"],
      data: payments,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).send({ success: false, message: error.message });
  }
};


module.exports = {
  // users
  getAllUserController,
  getAllResellerUsersController,
  getUserController,
  deleteUserController,
  editUserController,
  getCurrentMonthSales,
  // wallet
  adminAdjustUserBalanceController,
  adminGetWalletHistoryController,

  // bulk mail
  sendMailToIncompleteUsersController,

  // orders + payments
  adminGetAllOrdersController,
  adminUpdateOrderController,
  getAllPaymentsController,
};
