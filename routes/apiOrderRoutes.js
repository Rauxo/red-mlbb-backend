"use strict";

const express = require("express");
const axios = require("axios");
const qs = require("qs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const md5 = require("md5");

const authMiddleware = require("../middlewares/authMiddleware");
const paymentRequestModel = require("../models/paymentRequestModel");
const userModel = require("../models/userModel");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderModel");
const paymentModel = require("../models/paymentModel");
const querystring = require("querystring");
const matrixSols = require('../utils/matrixSols');

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
const yokcashHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Content-Type": "application/json",
  Accept: "application/json",
};
const {
  UID,
  EMAIL,
  KEY,
  SMILE_ONE_BASEURL_BR = "https://www.smile.one/br",
  SMILE_ONE_BASEURL_PH = "https://www.smile.one/ph",

  YOK_API_KEY,
  YOK_CONTACT = "6281234567890",
  YOK_CALLBACK,

  MOOGOLD_PARTNER_ID,
  MOOGOLD_SECRET,

  GATEWAY_CREATE_URL = "https://codeshop.in/api/create-order",
  GATEWAY_STATUS_URL = "https://codeshop.in/api/check-order-status",
  API_TOKEN,
  EXPAY_WEBHOOK_SECRET,
  FRONTEND_BASE_URL,

  POLL_ENABLED = "true",
  POLL_INTERVAL_SEC = "20",
  POLL_MAX_AGE_MIN = "10",
  POLL_LOCK_SEC = "12",
  POLL_BATCH_LIMIT = "50",
} = process.env;

const router = express.Router();

const colUsers = () => mongoose.connection.collection("users");
const colProductsPrimary = () => mongoose.connection.collection("product");
const colProductsAlt = () => mongoose.connection.collection("products");
const colOrders = () => mongoose.connection.collection("orders");
const colWalletHistory = () => mongoose.connection.collection("wallet_history");

const _now = () => new Date();
// const to2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const to2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function findProduct(query, options = {}) {
  let doc = await colProductsPrimary().findOne(query, options);
  if (!doc) doc = await colProductsAlt().findOne(query, options);
  return doc;
}

function getIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").toString();
  return (
    xff.split(",")[0].trim() || req.socket?.remoteAddress || req.ip || null
  );
}

function toObjectIdMaybe(x) {
  try {
    const s = String(x || "");
    if (/^[a-f0-9]{24}$/i.test(s)) return new mongoose.Types.ObjectId(s);
  } catch {}
  return null;
}

function isReseller(userDoc) {
  const role = String(userDoc?.role || "").toLowerCase();

  const r =
    userDoc?.is_reseller ??
    userDoc?.isReseller ??
    userDoc?.reseller ??
    userDoc?.is_reseller_active ??
    userDoc?.reseller_active;

  if (typeof r === "boolean") return r;
  if (typeof r === "number") return r === 1;

  const s = String(r || "")
    .toLowerCase()
    .trim();
  if (["yes", "true", "1", "active", "on"].includes(s)) return true;

  return role === "reseller";
}

function normalizeCostIdPieces(costIdRaw) {
  const s = String(costIdRaw || "").trim();
  if (!s) return [];
  return s
    .split(/[,&]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isSuccessTxn(s) {
  const v = String(s || "").toUpperCase();
  return ["COMPLETED", "SUCCESS", "PAID", "CAPTURED"].includes(v);
}
function isCancelTxn(s) {
  const v = String(s || "").toUpperCase();
  return ["CANCELLED", "CANCELED"].includes(v);
}
function isFailedTxn(s) {
  const v = String(s || "").toUpperCase();
  return ["FAILURE", "FAILED", "TIMEOUT"].includes(v);
}

function _parseSigHeader(sigHeader = "") {
  let t = null,
    v1 = null;
  String(sigHeader || "")
    .split(",")
    .forEach((p) => {
      const s = p.trim();
      if (s.startsWith("t=")) t = s.slice(2).trim();
      if (s.startsWith("v1=")) v1 = s.slice(3).trim();
    });
  return { t, v1 };
}

function _expectedWebhookHmac(ts, rawBody) {
  const secret = String(EXPAY_WEBHOOK_SECRET || "");
  return crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`, "utf8")
    .digest("hex");
}

async function loadAuthedUser(req) {
  const u = req.user || {};

  const oid = toObjectIdMaybe(u._id || u.id);
  if (oid) {
    const doc = await colUsers().findOne(
      { _id: oid },
      {
        projection: {
          email: 1,
          mobile: 1,
          phone: 1,
          balance: 1,
          googleId: 1,
          role: 1,
          is_reseller: 1,
          reseller: 1,
        },
      }
    );
    if (doc) return doc;
  }

  const gid =
    u.googleId || u.google_id || req.body?.googleId || req.body?.google_id;
  if (gid) {
    const doc = await colUsers().findOne(
      { googleId: String(gid) },
      {
        projection: {
          email: 1,
          mobile: 1,
          phone: 1,
          balance: 1,
          googleId: 1,
          role: 1,
          is_reseller: 1,
          reseller: 1,
        },
      }
    );
    if (doc) return doc;
  }

  return null;
}

function escapeRegex(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveProductCost({ product_name, cost_id, cost_amount }) {
  const name = String(product_name || "").trim();
  const cid = String(cost_id || "").trim();
  const amtLabel = String(cost_amount || "").trim();

  if (!cid && !name) return { ok: false, reason: "no_product_or_cost" };

  const proj = {
    projection: {
      _id: 1,
      name: 1,
      api: 1,

      apiName: 1,
      apiname: 1,
      api_name: 1,
      provider: 1,

      region: 1,
      gameType: 1,
      gameName: 1,

      packName: 1,
      cost: 1,
    },
  };

  let product = null;

  if (cid) product = await findProduct({ "cost.id": cid }, proj);

  if (!product && name) {
    product = await findProduct(
      { name: new RegExp(`^${escapeRegex(name)}$`, "i") },
      proj
    );
  }

  if (!product) return { ok: false, reason: "product_not_found" };

  const costs = Array.isArray(product.cost) ? product.cost : [];
  if (!costs.length) return { ok: false, reason: "no_costs" };

  let entry = null;
  if (cid) entry = costs.find((c) => String(c.id).trim() === cid);
  if (!entry && amtLabel)
    entry = costs.find((c) => String(c.amount || "").trim() === amtLabel);

  if (!entry) return { ok: false, reason: "cost_not_found" };

  const price = to2(entry.price ?? 0);
  const resPrice = to2(
    entry.resPrice ?? entry.resprice ?? entry.reseller_price ?? 0
  );
  const reward = to2(entry.reward ?? 0);

  const rawProvider = String(
    product.apiName ||
      product.apiname ||
      product.api_name ||
      product.provider ||
      ""
  ).trim();

  const provider = rawProvider.toLowerCase();
  const region = String(product.region || "")
    .toLowerCase()
    .trim();
  const gameType = String(product.gameType || "").trim();

  return {
    ok: true,
    product,
    entry,
    provider,
    region,
    gameType,
    price,
    resPrice,
    reward,
    packLabel: String(entry.amount || "").trim(),
    costId: String(entry.id || "").trim(),
  };
}

function buildOrderDocPublic({
  orderId,
  user,
  pr,
  product_name,
  game_userid,
  zoneid,
  price,
  mode,
  provider,
  partner_base_id,
}) {
  const now = _now();
  const email = String(user.email || "").toLowerCase();
  const mobile = user.mobile || user.phone || "9999999999";

  return {
    api: "yes",
    orderId: String(orderId),
    productinfo: String(product_name || "").trim(),
    amount: String(price),
    email,
    gameType: String(pr.gameType || "").trim(),
    mobile: String(mobile),
    orderDetails: String(pr.packLabel || "").trim(),
    userId: String(game_userid),
    zoneId: zoneid ? String(zoneid) : "",
    status: mode === "wallet" ? "processing" : "pending",
    orderDate: now,
    createdAt: now,
    updatedAt: now,
    __v: 0,

    payment_method: mode,
    region: String(pr.region || "")
      .toLowerCase()
      .trim(), // ✅ ADD
    provider: String(provider || "").toLowerCase(),
    product_id: String(pr.costId || ""),
    pack: String(pr.packLabel || ""),
    reward: pr.reward,
    reseller_used: isReseller(user),
    partner_order_id: String(partner_base_id || ""),
    payment_url: "",
    payment_status: "",
    failed_reason: "",
    external_order_ids: [],
    partner_order_ids: [],
    fulfillment: { claimed: false },
    webhook_deliveries: [],
  };
}

async function claimFulfillment(orderId, claimedBy) {
  const res = await colOrders().findOneAndUpdate(
    {
      orderId: String(orderId),
      status: { $in: ["pending", "processing"] },
      "fulfillment.claimed": { $ne: true },
    },
    {
      $set: {
        "fulfillment.claimed": true,
        "fulfillment.claimed_by": claimedBy,
        "fulfillment.claimed_at": _now(),
        updatedAt: _now(),
      },
    },
    { returnDocument: "before" }
  );
  return res?.value || null;
}

function runAsync(fn) {
  setImmediate(fn);
}

function smileSign(params, secret) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const inner = crypto
    .createHash("md5")
    .update(sorted + `&${secret}`, "utf8")
    .digest("hex");
  return crypto.createHash("md5").update(inner, "utf8").digest("hex");
}

function basicAuthHeader() {
  const token = Buffer.from(`${MOOGOLD_PARTNER_ID}:${MOOGOLD_SECRET}`).toString(
    "base64"
  );
  return `Basic ${token}`;
}

function moogoldAuthSig(bodyStr, timestamp, path) {
  const toSign = `${bodyStr}${timestamp}${path}`;
  return crypto
    .createHmac("sha256", MOOGOLD_SECRET)
    .update(toSign)
    .digest("hex");
}

function _ms(start) {
  return Number(Date.now() - start || 0);
}

function _trimJson(x, max = 2000) {
  try {
    const s = JSON.stringify(x);
    return s.length > max ? s.slice(0, max) + " ...<trimmed>" : s;
  } catch {
    return String(x);
  }
}

function _ip(req) {
  const xff = (req.headers["x-forwarded-for"] || "").toString();
  return xff.split(",")[0].trim() || req.socket?.remoteAddress || req.ip || "";
}

function logLine(tag, msg, obj) {
  const tail = obj ? ` | ${_trimJson(obj)}` : "";
  console.log(`[${tag}] ${msg}${tail}`);
}

function logErr(tag, msg, err) {
  console.error(
    `[${tag}] ${msg}\n` +
      `err: ${String(err?.message || err)}\n` +
      (err?.response?.status ? `http: ${err.response.status}\n` : "") +
      (err?.response?.data ? `resp: ${_trimJson(err.response.data)}\n` : "")
  );
}

function safeGatewayPayload(p) {
  const o = { ...(p || {}) };
  if ("user_token" in o) o.user_token = "***";
  return o;
}

function logErr(tag, err, tookMs) {
  const httpStatus = err?.response?.status;
  const body = err?.response?.data;
  console.error(
    `[${tag}] !! ERROR (${tookMs}ms)` +
      (httpStatus ? ` HTTP ${httpStatus}` : "") +
      `\nmsg: ${String(err?.message || err)}\n` +
      (body ? `resp: ${JSON.stringify(body).slice(0, 2000)}\n` : "")
  );
}
async function createSmileOne({
  baseUrl,
  userid,
  zoneid,
  game = "mobilelegends",
  productid,
}) {
  const url = `${baseUrl}/smilecoin/api/createorder`;
  const now = Math.floor(Date.now() / 1000);

  const params = {
    uid: UID,
    email: EMAIL,
    userid,
    zoneid: zoneid || "",
    product: game || "mobilelegends",
    productid,
    time: now,
  };
  params.sign = smileSign(params, KEY);

  logApi("smileone.request", {
    url,
    params: {
      ...params,
      uid: mask(params.uid),
      email: mask(params.email, 2),
      sign: mask(params.sign, 6),
    },
  });

  let r;
  try {
    r = await axios.post(url, qs.stringify(params), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
      validateStatus: () => true,
    });
  } catch (err) {
    logApi("smileone.error", pickAxiosError(err));
    throw err;
  }

  logApi("smileone.response", { status: r.status, data: r.data });

  const data = r.data || {};
  if (r.status === 200 && Number(data.status) === 200)
    return String(data.order_id);
  throw new Error(data.message || `smileone_http_${r.status}`);
}

async function createYokOrder({ service_id, userid, zoneid, partnerOrderId }) {
  if (!YOK_API_KEY) throw new Error("YOK_API_KEY not configured");

  let contact = String(YOK_CONTACT || "").trim();
  if (!contact.startsWith("62")) contact = "62" + contact.replace(/^0+/, "");

  const target = zoneid ? `${userid}|${zoneid}` : userid;

  const payload = {
    api_key: YOK_API_KEY,
    service_id: String(service_id),
    target,
    kontak: contact,
    idtrx: partnerOrderId,
  };
  if (YOK_CALLBACK) payload.callback = YOK_CALLBACK;

  logApi("yok.request", {
    url: "https://api.yokcash.com/order",
    payload: { ...payload, api_key: mask(payload.api_key, 6) },
  });

  let r;
  try {
    r = await axios.post("https://api.yokcash.com/order", payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 20000,
      validateStatus: () => true,
    });
  } catch (err) {
    logApi("yok.error", pickAxiosError(err));
    throw err;
  }

  logApi("yok.response", { status: r.status, data: r.data });

  if (r.status !== 200) throw new Error(`yok_http_${r.status}`);

  const data = r.data || {};
  if (!data.status) throw new Error(data.msg || "yok_failed");

  const providerOrderId = data?.data?.id || data?.id || partnerOrderId;
  return String(providerOrderId);
}

async function createMooGold({
  game,
  userid,
  zoneid,
  productid,
  partnerOrderId,
}) {
  if (!MOOGOLD_PARTNER_ID || !MOOGOLD_SECRET)
    throw new Error("MOOGOLD not configured");

  const url = "https://moogold.com/wp-json/v1/api/order/create_order";
  const path = "order/create_order";
  const zoneField = game === "genshin_impact" ? "Server" : "Server ID";

  const payload = {
    path,
    data: {
      category: 50,
      "product-id": productid,
      quantity: 1,
      "User ID": userid,
      [zoneField]: zoneid || "",
    },
    partnerOrderId,
  };

  const bodyStr = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const auth = moogoldAuthSig(bodyStr, timestamp, path);

  logApi("moogold.request", {
    url,
    headers: { Authorization: "Basic ***", auth: mask(auth, 8), timestamp },
    payload,
  });

  let r;
  try {
    r = await axios.post(url, payload, {
      headers: {
        Authorization: basicAuthHeader(),
        auth,
        timestamp,
        "Content-Type": "application/json",
      },
      timeout: 20000,
      validateStatus: () => true,
    });
  } catch (err) {
    logApi("moogold.error", pickAxiosError(err));
    throw err;
  }

  logApi("moogold.response", { status: r.status, data: r.data });

  const data = r.data || {};
  if (r.status === 200) return String(data.orderId || data.order_id || "");
  throw new Error(`moogold_http_${r.status}`);
}

function mask(s, keep = 4) {
  const v = String(s || "");
  if (!v) return v;
  if (v.length <= keep) return "*".repeat(v.length);
  return v.slice(0, keep) + "***";
}

function logApi(tag, obj) {
  console.log(`[api] ${tag}`, JSON.stringify(obj, null, 2));
}

function pickAxiosError(err) {
  return {
    message: String(err?.message || err),
    status: err?.response?.status,
    data: err?.response?.data,
  };
}

async function createExternalOrder({
  provider,
  region,
  game,
  userid,
  zoneid,
  productid,
  partnerOrderId,
}) {
  const p = String(provider || "")
    .toLowerCase()
    .trim();
  const r = String(region || "")
    .toLowerCase()
    .trim();

  logApi("external.dispatch", {
    provider: p,
    region: r,
    userid,
    zoneid: zoneid || "",
    productid,
    partnerOrderId,
  });

  try {
    let out;

    if (p === "smileone" || p === "smile_one" || p === "smileOne") {
      const baseUrl =
        r === "philippines" || r === "ph"
          ? SMILE_ONE_BASEURL_PH
          : r === "brazil" || r === "br"
          ? SMILE_ONE_BASEURL_BR
          : SMILE_ONE_BASEURL_PH;

      logApi("smileone.route", { provider: p, region: r, baseUrl });

      out = await createSmileOne({
        baseUrl,
        userid,
        zoneid,
        game: game || "mobilelegends",
        productid,
      });
    } else if (p === "yok" || p === "yokcash") {
      out = await createYokOrder({
        service_id: productid,
        userid,
        zoneid,
        partnerOrderId,
      });
    } else if (p === "moogold") {
      out = await createMooGold({
        game,
        userid,
        zoneid,
        productid,
        partnerOrderId,
      });
    }else if (p === "matrixsols") {
    // Note: productid is the item_id from Matrix Sols
    const orderResponse = await matrixSols.createOrder(productid, userid, zoneid, '');
    // The response contains an order_id – store it
    out = orderResponse.data.order_id;
} else {
    throw new Error(`provider_not_supported:${p}`);
}

    logApi("external.result", { provider: p, external_order_id: String(out) });
    return String(out);
  } catch (err) {
    logApi("external.failed", { provider: p, error: pickAxiosError(err) });
    throw err;
  }
}

async function creditRewardOnce(orderId, source = "reward") {
  const oid = String(orderId || "").trim();
  if (!oid) return;

  const claimed = await colOrders().findOneAndUpdate(
    { orderId: oid, status: "success", reward_credited: { $ne: true } },
    {
      $set: {
        reward_credited: true,
        reward_credited_at: _now(),
        reward_credited_by: source,
        updatedAt: _now(),
      },
    },
    { returnDocument: "after" }
  );

  const order = claimed?.value;
  if (!order) return;

  const reward = Number(order.reward || 0);
  if (!reward || reward <= 0) return;

  const q =
    order.user_db_id && toObjectIdMaybe(order.user_db_id)
      ? { _id: toObjectIdMaybe(order.user_db_id) }
      : { email: String(order.email || "").toLowerCase() };

  // credit balance
  // const upd = await colUsers().findOneAndUpdate(
  //   q,
  //   { $inc: { balance: reward } },
  //   { returnDocument: "after", projection: { balance: 1, email: 1 } }
  // );
  const reward2 = to2(reward);

  const upd = await colUsers().findOneAndUpdate(
    q,
    [
      {
        $set: {
          balance: {
            $round: [{ $add: ["$balance", reward2] }, 2],
          },
        },
      },
    ],
    { returnDocument: "after", projection: { balance: 1, email: 1 } }
  );

  const after = Number(upd?.value?.balance ?? 0);

  const txnId = `REWARD-${oid}-${Date.now()}-${crypto
    .randomBytes(3)
    .toString("hex")}`;
  await colWalletHistory().insertOne({
    userId: upd?.value?._id || order.user_db_id || null,
    email: upd?.value?.email || String(order.email || "").toLowerCase(),
    amount: reward,
    type: "CREDIT",
    mode: "REWARD",
    transaction_id: txnId,
    status: "SUCCESS",
    message: `Order reward for ${oid} (${order.productinfo || ""} - ${
      order.pack || ""
    })`,
    changedByAdmin: null,
    adminId: null,
    ip: null,
    balanceAfter: after,
    createdAt: _now(),
  });

  await colOrders().updateOne(
    { orderId: oid },
    { $set: { reward_txn_id: txnId, updatedAt: _now() } }
  );
}

function kickFulfill(orderDoc, source) {
  runAsync(async () => {
    try {
      const provider = String(orderDoc.provider || "");
      const pieces = normalizeCostIdPieces(orderDoc.product_id);
      const ids = pieces.length ? pieces : [String(orderDoc.product_id)];

      const external_order_ids = [];
      const partner_order_ids = [];

      for (let i = 0; i < ids.length; i++) {
        const pid = ids[i];
        const partnerOrderId = `${
          orderDoc.partner_order_id
        }-${pid}-${i}-${crypto.randomBytes(3).toString("hex")}`;

        const extId = await createExternalOrder({
          provider,
          game: orderDoc.gameType,
          region: orderDoc.region,
          userid: String(orderDoc.userId),
          zoneid: String(orderDoc.zoneId || ""),
          productid: pid,
          partnerOrderId,
        });

        partner_order_ids.push(partnerOrderId);
        external_order_ids.push(String(extId));
      }

      await colOrders().updateOne(
        { orderId: String(orderDoc.orderId) },
        {
          $set: {
            status: "success",
            payment_status: "success",
            external_order_ids,
            partner_order_ids,
            fulfilled_at: _now(),
            updatedAt: _now(),
            orderDate: _now(),
          },
        }
      );
      await creditRewardOnce(String(orderDoc.orderId), `fulfill:${source}`);
    } catch (err) {
      await colOrders().updateOne(
        { orderId: String(orderDoc.orderId) },
        {
          $set: {
            status: "failed",
            failed_reason: `fulfillment_error:${String(err?.message || err)}`,
            updatedAt: _now(),
          },
        }
      );
    }
  });
}

router.post("/create", authMiddleware, express.json(), async (req, res) => {
  try {
    const {
      userid: game_userid,
      zoneid,
      cost_id,
      cost_amount,
      payment_mode,
      product_name,
    } = req.body || {};

    const mode = String(payment_mode || "")
      .toLowerCase()
      .trim(); // "wallet" | "upi"
    if (!game_userid || !cost_id || !product_name || !mode) {
      return res.status(400).json({
        success: false,
        message: "userid, cost_id, product_name, payment_mode required",
      });
    }
    if (!["wallet", "upi"].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: "payment_mode must be wallet or upi",
      });
    }

    const user = await loadAuthedUser(req);
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "User not found (auth)" });

    const pr = await resolveProductCost({ product_name, cost_id, cost_amount });
    if (!pr.ok) {
      return res.status(404).json({
        success: false,
        message: `Product/Pack not found: ${pr.reason}`,
      });
    }

    const provider = String(pr.provider || "").trim();
    if (!provider)
      return res.status(400).json({
        success: false,
        message: "apiName/provider missing in product",
      });

    const reseller = isReseller(user);
    const priceToCharge = reseller && pr.resPrice > 0 ? pr.resPrice : pr.price;

    if (!Number.isFinite(priceToCharge) || priceToCharge <= 0) {
      return res.status(400).json({ success: false, message: "Invalid price" });
    }

    const price = priceToCharge;
    const orderId = generateOrderId();
    const partner_base_id = `UPI-${provider.toUpperCase()}-${Date.now()}-${orderId}`;

    const orderDoc = buildOrderDocPublic({
      orderId,
      user,
      pr,
      product_name,
      game_userid,
      zoneid,
      price,
      mode,
      provider,
      partner_base_id,
    });

    await colOrders().insertOne(orderDoc);

    if (mode === "wallet") {
      const q = user?._id ? { _id: user._id } : { googleId: user.googleId };
      const uFresh = await colUsers().findOne(q, {
        projection: { balance: 1, email: 1 },
      });
      const before = Number(uFresh?.balance ?? 0);

      if (before < price) {
        await colOrders().updateOne(
          { orderId: String(orderId) },
          {
            $set: {
              status: "failed",
              failed_reason: "insufficient_balance",
              updatedAt: _now(),
            },
          }
        );
        return res
          .status(402)
          .json({ success: false, message: "Insufficient balance" });
      }

      // const delta = -Number(price);

      // const upd = await colUsers().findOneAndUpdate(
      //   q,
      //   { $inc: { balance: delta } },
      //   { returnDocument: "after", projection: { balance: 1, email: 1 } }
      // );
      const delta = -to2(price);
      const delta2 = to2(delta);

      const upd = await colUsers().findOneAndUpdate(
        q,
        [
          {
            $set: {
              balance: {
                $round: [{ $add: ["$balance", delta2] }, 2],
              },
            },
          },
        ],
        { returnDocument: "after", projection: { balance: 1, email: 1 } }
      );

      const updated = upd?.value || {};
      const after = Number(updated.balance || 0);

      const txnId =
        "ORDER-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");
      await colWalletHistory().insertOne({
        userId: user._id || null,
        email: updated.email || String(user.email || "").toLowerCase(),
        amount: to2(Math.abs(delta)),
        type: "DEBIT",
        mode: "ORDER",
        transaction_id: txnId,
        status: "SUCCESS",
        message: String(cost_amount || pr.packLabel || ""),
        changedByAdmin: null,
        adminId: null,
        ip: getIp(req),
        balanceBefore: before,
        balanceAfter: after,
      });

      const claimedPrev = await claimFulfillment(String(orderId), "wallet");
      if (claimedPrev) {
        await colOrders().updateOne(
          { orderId: String(orderId) },
          {
            $set: {
              status: "processing",
              payment_status: "success",
              updatedAt: _now(),
            },
          }
        );
        // kickFulfill({ ...claimedPrev, orderId: String(orderId) }, "wallet");
        kickFulfill(
          {
            ...claimedPrev,
            orderId: String(orderId),
            gameType: claimedPrev.gameType,
            region: claimedPrev.region, // ✅ ADD
          },
          "wallet"
        );
      }

      return res.json({
        success: true,
        mode: "wallet",
        orderId: String(orderId),
        amount: String(price),
        status: "processing",
        redirect: `${FRONTEND_BASE_URL}orders`,
      });
    }

    if (!API_TOKEN) {
      await colOrders().updateOne(
        { orderId: String(orderId) },
        {
          $set: {
            status: "failed",
            failed_reason: "no_gateway_key",
            updatedAt: _now(),
          },
        }
      );
      return res.status(500).json({
        success: false,
        message: "Gateway not configured (API_TOKEN missing)",
      });
    }

    const mobile = user.mobile || user.phone || "9999999999";
    const redirect_url = `${FRONTEND_BASE_URL}orders`;

    const form = {
      customer_mobile: String(mobile),
      user_token: API_TOKEN,
      amount: String(price),
      order_id: String(orderId),
      redirect_url,
      remark1: `${game_userid}|${zoneid || ""}|${pr.costId}`,
      remark2: "upi-order",
    };

    const gwResp = await axios.post(GATEWAY_CREATE_URL, qs.stringify(form), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
      validateStatus: () => true,
    });

    const gw = gwResp.data || {};
    if (!gw.status) {
      await colOrders().updateOne(
        { orderId: String(orderId) },
        {
          $set: {
            status: "failed",
            failed_reason: `gateway_error:${gw.message || "unknown"}`,
            updatedAt: _now(),
          },
        }
      );
      return res
        .status(502)
        .json({ success: false, message: gw.message || "Gateway failure" });
    }

    const payment_url = String(gw?.result?.payment_url || "").trim();
    if (!payment_url) {
      await colOrders().updateOne(
        { orderId: String(orderId) },
        {
          $set: {
            status: "failed",
            failed_reason: "no_payment_url",
            updatedAt: _now(),
          },
        }
      );
      return res
        .status(502)
        .json({ success: false, message: "No payment_url from gateway" });
    }

    await colOrders().updateOne(
      { orderId: String(orderId) },
      { $set: { payment_url, updatedAt: _now() } }
    );

    return res.json({
      success: true,
      mode: "upi",
      orderId: String(orderId),
      amount: String(price),
      pack: pr.packLabel,
      payment_url,
      status: "pending",
      redirect: payment_url,
    });
  } catch (err) {
    console.error("order/create err:", err?.response?.data || err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/upi/status/:orderId", authMiddleware, async (req, res) => {
  const started = Date.now();
  const tag = "UPI_STATUS";
  try {
    const orderId = String(req.params.orderId || "").trim();
    logLine(tag, `hit orderId=${orderId} ip=${_ip(req)}`);

    if (!orderId) {
      logLine(tag, "missing orderId");
      return res
        .status(400)
        .json({ success: false, message: "orderId required" });
    }

    const user = await loadAuthedUser(req);
    if (!user) {
      logLine(tag, `auth user not found orderId=${orderId}`);
      return res
        .status(401)
        .json({ success: false, message: "User not found (auth)" });
    }

    const order = await colOrders().findOne({ orderId: String(orderId) });
    if (
      !order ||
      String(order.email || "").toLowerCase() !==
        String(user.email || "").toLowerCase()
    ) {
      logLine(tag, `order not found/forbidden orderId=${orderId}`, {
        haveOrder: !!order,
        orderEmail: order?.email,
        userEmail: user?.email,
      });
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    logLine(
      tag,
      `db status=${order.status} payment_status=${order.payment_status || ""}`,
      {
        amount: order.amount,
        payment_method: order.payment_method,
        orderDate: order.orderDate,
      }
    );

    if (String(order.status) !== "pending") {
      logLine(
        tag,
        `short-circuit not pending -> ${order.status} (${_ms(started)}ms)`
      );
      return res.json({
        success: true,
        status: order.status,
        payment_status: order.payment_status || order.status,
      });
    }

    // gateway poll
    const gwPayload = { user_token: API_TOKEN, order_id: String(orderId) };
    logLine(
      tag,
      `gateway -> ${GATEWAY_STATUS_URL}`,
      safeGatewayPayload(gwPayload)
    );

    const r = await axios.post(GATEWAY_STATUS_URL, qs.stringify(gwPayload), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
      validateStatus: () => true,
    });

    logLine(tag, `gateway <- HTTP ${r.status} (${_ms(started)}ms)`, r.data);

    const data = r.data || {};
    if (!data.status) {
      logLine(
        tag,
        `gateway says status=false -> treat pending (${_ms(started)}ms)`,
        data
      );
      return res.json({ success: true, status: "pending" });
    }

    const result = data.result || {};
    const txn = String(result.txnStatus || "").toUpperCase();
    const paid = to2(result.amount);
    const want = to2(order.amount);

    logLine(tag, `parsed txn=${txn} paid=${paid} want=${want}`, {
      utr: result.utr || null,
      date: result.date || null,
    });

    if (isSuccessTxn(txn)) {
      if (paid !== want) {
        logLine(tag, `amount mismatch -> fail paid=${paid} want=${want}`);
        await colOrders().updateOne(
          { orderId: String(orderId) },
          {
            $set: {
              status: "failed",
              payment_status: "failed",
              failed_reason: `amount_mismatch ${paid}!=${want}`,
              updatedAt: _now(),
            },
          }
        );
        return res.json({
          success: true,
          status: "failed",
          payment_status: "failed",
        });
      }

      const claimedPrev = await claimFulfillment(
        String(orderId),
        "frontend_poll"
      );
      logLine(tag, `claimFulfillment=${!!claimedPrev}`, {
        claimedBy: "frontend_poll",
        prevStatus: claimedPrev?.status,
        alreadyClaimed: !claimedPrev,
      });

      if (claimedPrev) {
        await colOrders().updateOne(
          { orderId: String(orderId) },
          {
            $set: {
              status: "processing",
              payment_status: "success",
              paid_amount: paid,
              paid_at: _now(),
              updatedAt: _now(),
              orderDate: _now(),
            },
          }
        );
        logLine(tag, `kickFulfill starting (${_ms(started)}ms)`);
        kickFulfill(
          {
            ...claimedPrev,
            orderId: String(orderId),
            gameType: claimedPrev.gameType,
            region: claimedPrev.region, // ✅ ADD
          },
          "frontend_poll"
        );
      }

      return res.json({
        success: true,
        status: "processing",
        payment_status: "success",
      });
    }

    if (isCancelTxn(txn)) {
      logLine(tag, `txn cancelled -> set cancelled`);
      await colOrders().updateOne(
        { orderId: String(orderId), status: { $ne: "success" } },
        {
          $set: {
            status: "cancelled",
            failed_reason: "gateway_cancelled",
            updatedAt: _now(),
          },
        }
      );
      return res.json({ success: true, status: "cancelled" });
    }

    if (isFailedTxn(txn)) {
      logLine(tag, `txn failed -> set failed txn=${txn}`);
      await colOrders().updateOne(
        { orderId: String(orderId), status: { $ne: "success" } },
        {
          $set: {
            status: "failed",
            payment_status: "failed",
            failed_reason: `gateway_${txn.toLowerCase()}`,
            updatedAt: _now(),
          },
        }
      );
      return res.json({
        success: true,
        status: "failed",
        payment_status: "failed",
      });
    }

    logLine(tag, `txn pending -> return pending (${_ms(started)}ms)`);
    return res.json({ success: true, status: "pending" });
  } catch (err) {
    logErr("UPI_STATUS", "handler error", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});
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
      service: "gmail",
      auth: {
        user: process.env.MAIL,
        pass: process.env.APP_PASSWORD,
      },
    });

    await mailTransporter.sendMail({
      from: process.env.MAIL,
      to: customer_email,
      subject: "Cart Orders Successful!",
      html: htmlContent,
    });
  } catch (error) {
    console.error("Error sending cart email:", error);
  }
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

  const requestBody = {
    api_key: API_KEY,
    service_id: productid,
    target: `${userid}|${zoneid}`,
    kontak: kontak,
    idtrx: subOrderId,
    callback: "https://wurustore.in/api/yokcash/callback",
  };

  console.log(`Yokcash API Request for ${pname}:`, requestBody);

  const response = await axios.post(url, requestBody, {
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
    status: "pending",
  });
  await order.save();

  return response.data;
};
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
    );

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
    orderId: subOrderId,
    email: customer_email,
    mobile: customer_mobile,
    userId: userid,
    zoneId: zoneid,
    status: "success",
  });
  await order.save();
};
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

  // Logic for different games
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

  const authSignature = crypto
    .createHmac("sha256", process.env.MOOGOLD_SECRET)
    .update(`${JSON.stringify(payload)}${timestamp}${path}`)
    .digest("hex");

  const credentials = `${process.env.MOOGOLD_PARTNER_ID}:${process.env.MOOGOLD_SECRET}`;
  const basicAuth = Buffer.from(credentials).toString("base64");

  const response = await axios.post(
    "https://moogold.com/wp-json/v1/api/order/create_order",
    payload,
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        auth: authSignature,
        timestamp: timestamp,
      },
    }
  );

  console.log(`Moogold API Response for ${pname}:`, response.data);

  if (response.status === 200 && response.data.status) {
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
// Place order for cart items
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

// router.post("/gateway/webhook", async (req, res) => {
//   const tag = "EXPAY_WEBHOOK";
//   const started = Date.now();
//   try {
//     logLine(
//       tag,
//       `hit ip=${_ip(req)} event=${String(req.get("x-expay-event") || "")}`
//     );

//     const secret = String(EXPAY_WEBHOOK_SECRET || "");
//     if (!secret) {
//       logLine(tag, "no webhook secret configured");
//       return res.status(500).json({ ok: false, err: "no_webhook_secret" });
//     }

//     const raw = Buffer.isBuffer(req.body)
//       ? req.body.toString("utf8")
//       : typeof req.rawBody === "string"
//       ? req.rawBody
//       : "";

//     if (!raw) {
//       logLine(tag, "no raw body captured (check express.json verify)");
//       return res.status(400).json({ ok: false, err: "no_raw_body" });
//     }

//     const tsHeader = String(req.get("x-expay-timestamp") || "");
//     const sigHeader = String(req.get("x-expay-signature") || "");
//     const deliveryId = String(req.get("x-expay-delivery") || "");

//     const { t, v1 } = _parseSigHeader(sigHeader);
//     const ts = tsHeader || t || "";
//     if (!ts || !v1) {
//       logLine(tag, "bad signature headers", { tsHeader, sigHeader });
//       return res.status(400).json({ ok: false, err: "bad_sig_header" });
//     }

//     const expected = _expectedWebhookHmac(ts, raw);
//     if (String(v1).toLowerCase() !== String(expected).toLowerCase()) {
//       logLine(tag, "bad signature", { got: v1, expected });
//       return res.status(400).json({ ok: false, err: "bad_signature" });
//     }

//     // reply FAST
//     res.sendStatus(200);
//     logLine(tag, `ack 200 sent (${_ms(started)}ms) delivery=${deliveryId}`);

//     runAsync(async () => {
//       const wTag = "EXPAY_WEBHOOK_WORKER";
//       const wStart = Date.now();

//       let payload = {};
//       try {
//         payload = JSON.parse(raw);
//       } catch (e) {
//         logErr(wTag, "json parse error", e);
//         return;
//       }

//       const result = payload.result || payload;
//       const orderId = String(result.orderId || result.order_id || "").trim();
//       if (!orderId) {
//         logLine(wTag, "missing orderId in payload", result);
//         return;
//       }

//       logLine(wTag, `payload orderId=${orderId} (${_ms(wStart)}ms)`, {
//         txnStatus: result.txnStatus,
//         amount: result.amount,
//         utr: result.utr || null,
//       });

//       // 🚨 CRITICAL FIX: Check paymentRequest first (for cart orders)
//       const paymentRequest = await paymentRequestModel.findOne({
//         orderId: String(orderId),
//       });

//       if (paymentRequest && paymentRequest.orderType === "cart") {
//         const eventType = String(req.get("x-expay-event") || "").toUpperCase();

//         let txn = String(result.txnStatus || "").toUpperCase();

//         // 🔁 Fallback to webhook event (Expay behavior)
//         if (!txn && eventType === "PAYMENT_SUCCESS") txn = "SUCCESS";
//         if (!txn && eventType === "PAYMENT_FAILED") txn = "FAILED";
//         if (!txn && eventType === "PAYMENT_CANCELLED") txn = "CANCELLED";

//         const paid = Number(result.amount || 0);
//         const expected = Number(paymentRequest.txn_amount || 0);

//         logLine(wTag, `CART payment check`, {
//           txn,
//           paid,
//           expected,
//           utr: result.utr || null,
//         });

//         // ❌ STOP: payment NOT successful
//         if (!isSuccessTxn(txn)) {
//           logLine(wTag, `CART ignored – payment not successful txn=${txn}`);
//           return;
//         }

//         // ❌ STOP: amount mismatch
//         if (paid !== expected) {
//           logLine(
//             wTag,
//             `CART ignored – amount mismatch paid=${paid} expected=${expected}`
//           );
//           return;
//         }

//         // ❌ STOP: missing UTR
//         if (!result.utr) {
//           logLine(wTag, `CART ignored – missing UTR`);
//           return;
//         }

//         logLine(wTag, `Processing CART orderId=${orderId}`);

//         const user = await userModel.findOne({
//           email: paymentRequest.customer_email,
//         });

//         if (!user) {
//           logLine(wTag, `User not found for cart order orderId=${orderId}`);
//           return;
//         }

//         let failures = [];

//         // 🔁 Process cart items ONLY AFTER PAYMENT CONFIRMED
//         for (let i = 0; i < paymentRequest.cart.length; i++) {
//           const item = paymentRequest.cart[i];
//           const subOrderId = `${orderId}-${i}`;

//           try {
//             await placeOrder(
//               item.apiName,
//               item,
//               orderId,
//               subOrderId,
//               user.email,
//               user.mobile,
//               item.pack.price
//             );
//           } catch (err) {
//             console.error("Cart item failed:", item.productName, err);

//             // ❌ FAIL ENTIRE CART
//             await paymentRequestModel.updateOne(
//               { _id: paymentRequest._id },
//               {
//                 $set: {
//                   status: "failed",
//                   failed_reason: `item_failed:${item.productName}`,
//                   utr: result.utr,
//                   updatedAt: new Date(),
//                 },
//               }
//             );

//             return; // ⛔ STOP processing further items
//           }
//         }

//         // 🧹 Clear user's cart AFTER processing
//         user.cart = [];
//         await user.save();

//         // 📌 Update payment request status
//         // paymentRequest.status = failures.length ? "partial" : "completed";
//         // paymentRequest.utr = result.utr;
//         // await paymentRequest.save();
//         await paymentRequestModel.updateOne(
//           { _id: paymentRequest._id },
//           {
//             $set: {
//               status: failures.length === 0 ? "completed" : "failed",
//               utr: result.utr,
//               updatedAt: new Date(),
//             },
//           }
//         );

//         // 💾 Save payment record (UTR guaranteed)
//         await paymentModel.create({
//           orderId,
//           name: paymentRequest.customer_name,
//           email: paymentRequest.customer_email,
//           mobile: paymentRequest.customer_mobile,
//           amount: paid,
//           status: "SUCCESS",
//           utrNumber: result.utr,
//           type: "cart_purchase",
//           createdAt: new Date(),
//         });

//         if (failures.length > 0) {
//           logLine(wTag, `Cart processed with failures: ${failures.join(", ")}`);
//         } else {
//           logLine(wTag, `Cart order ${orderId} fully processed`);
//         }

//         return;
//       }

//       const base = await colOrders().findOne({ orderId: String(orderId) });
//       if (!base) {
//         logLine(wTag, `order not found in DB orderId=${orderId}`);
//         return;
//       }

//       if (deliveryId) {
//         await colOrders().updateOne(
//           { orderId: String(orderId) },
//           { $addToSet: { webhook_deliveries: deliveryId } }
//         );
//         logLine(wTag, `saved deliveryId=${deliveryId}`);
//       }

//       const txn = String(result.txnStatus || "").toUpperCase();
//       const paid = to2(result.amount);
//       const want = to2(base.amount);

//       logLine(
//         wTag,
//         `txn=${txn} paid=${paid} want=${want} dbStatus=${base.status}`
//       );

//       if (isSuccessTxn(txn)) {
//         if (paid !== want) {
//           logLine(wTag, `amount mismatch -> fail ${paid}!=${want}`);
//           await colOrders().updateOne(
//             { orderId: String(orderId) },
//             {
//               $set: {
//                 status: "failed",
//                 payment_status: "failed",
//                 failed_reason: `amount_mismatch ${paid}!=${want}`,
//                 updatedAt: _now(),
//               },
//             }
//           );
//           return;
//         }

//         const claimedPrev = await claimFulfillment(String(orderId), "webhook");
//         logLine(wTag, `claimFulfillment=${!!claimedPrev}`, {
//           claimedBy: "webhook",
//         });

//         if (claimedPrev) {
//           await colOrders().updateOne(
//             { orderId: String(orderId) },
//             {
//               $set: {
//                 status: "processing",
//                 payment_status: "success",
//                 paid_amount: paid,
//                 paid_at: _now(),
//                 updatedAt: _now(),
//                 orderDate: _now(),
//               },
//             }
//           );
//           logLine(wTag, `kickFulfill starting (${_ms(wStart)}ms)`);
//           // kickFulfill({ ...claimedPrev, orderId: String(orderId) }, "webhook");
//           kickFulfill(
//             {
//               ...claimedPrev,
//               orderId: String(orderId),
//               gameType: claimedPrev.gameType,
//               region: claimedPrev.region, // ✅ ADD
//             },
//             "webhook"
//           );
//         }
//         return;
//       }

//       if (isCancelTxn(txn)) {
//         logLine(wTag, `cancel -> set cancelled`);
//         await colOrders().updateOne(
//           { orderId: String(orderId), status: { $ne: "success" } },
//           {
//             $set: {
//               status: "cancelled",
//               failed_reason: "gateway_cancelled",
//               updatedAt: _now(),
//             },
//           }
//         );
//         return;
//       }

//       if (isFailedTxn(txn)) {
//         logLine(wTag, `fail -> set failed txn=${txn}`);
//         await colOrders().updateOne(
//           { orderId: String(orderId), status: { $ne: "success" } },
//           {
//             $set: {
//               status: "failed",
//               payment_status: "failed",
//               failed_reason: `gateway_${txn.toLowerCase()}`,
//               updatedAt: _now(),
//             },
//           }
//         );
//         return;
//       }

//       logLine(
//         wTag,
//         `pending -> ignore (poller will handle) (${_ms(wStart)}ms)`
//       );
//     });
//   } catch (e) {
//     logErr(tag, "webhook handler error", e);
//     return res.sendStatus(200);
//   }
// });

async function pollPendingOrdersBatch() {
  const tag = "BG_POLLER";
  const started = Date.now();

  const enabled = String(POLL_ENABLED || "true").toLowerCase() === "true";
  if (!enabled) return;

  const maxAgeMin = Math.max(1, Number(POLL_MAX_AGE_MIN || 10));
  const since = new Date(Date.now() - maxAgeMin * 60 * 1000);

  const limit = Math.max(1, Number(POLL_BATCH_LIMIT || 50));
  const lockSec = Math.max(5, Number(POLL_LOCK_SEC || 12));
  const lockUntil = new Date(Date.now() + lockSec * 1000);

  logLine(
    tag,
    `scan pending since=${since.toISOString()} limit=${limit} lockSec=${lockSec}`
  );

  const orders = await colOrders()
    .find(
      {
        payment_method: "upi",
        status: "pending",
        orderDate: { $gte: since },
        $or: [
          { poll_lock_until: { $exists: false } },
          { poll_lock_until: { $lt: new Date() } },
        ],
      },
      { projection: { orderId: 1, amount: 1 } }
    )
    .limit(limit)
    .toArray();

  logLine(tag, `found=${orders.length} (${_ms(started)}ms)`);

  for (const o of orders) {
    const oid = String(o.orderId || "");
    if (!oid) continue;

    const lock = await colOrders().updateOne(
      {
        orderId: oid,
        status: "pending",
        $or: [
          { poll_lock_until: { $exists: false } },
          { poll_lock_until: { $lt: new Date() } },
        ],
      },
      { $set: { poll_lock_until: lockUntil, poll_lock_by: "bg-poller" } }
    );

    if (!lock.matchedCount) {
      logLine(tag, `skip locked oid=${oid}`);
      continue;
    }

    const oneStart = Date.now();
    try {
      const gwPayload = { user_token: API_TOKEN, order_id: oid };
      logLine(
        tag,
        `check oid=${oid} -> gateway`,
        safeGatewayPayload(gwPayload)
      );

      const r = await axios.post(GATEWAY_STATUS_URL, qs.stringify(gwPayload), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
        validateStatus: () => true,
      });

      logLine(
        tag,
        `oid=${oid} <- HTTP ${r.status} (${_ms(oneStart)}ms)`,
        r.data
      );

      const data = r.data || {};
      if (!data.status) {
        logLine(tag, `oid=${oid} gateway status=false -> continue`);
        continue;
      }

      const result = data.result || {};
      const txn = String(result.txnStatus || "").toUpperCase();
      const paid = to2(result.amount);

      const base = await colOrders().findOne({ orderId: oid });
      if (!base) {
        logLine(tag, `oid=${oid} missing in DB after lock`);
        continue;
      }

      const want = to2(base.amount);
      logLine(tag, `oid=${oid} txn=${txn} paid=${paid} want=${want}`);

      if (isSuccessTxn(txn)) {
        if (paid !== want) {
          logLine(tag, `oid=${oid} amount mismatch -> fail`);
          await colOrders().updateOne(
            { orderId: oid },
            {
              $set: {
                status: "failed",
                payment_status: "failed",
                failed_reason: `amount_mismatch ${paid}!=${want}`,
                updatedAt: _now(),
              },
            }
          );
          continue;
        }

        const claimedPrev = await claimFulfillment(oid, "bg_poller");
        logLine(tag, `oid=${oid} claimFulfillment=${!!claimedPrev}`);

        if (claimedPrev) {
          await colOrders().updateOne(
            { orderId: oid },
            {
              $set: {
                status: "processing",
                payment_status: "success",
                paid_amount: paid,
                paid_at: _now(),
                updatedAt: _now(),
                orderDate: _now(),
              },
            }
          );
          logLine(tag, `oid=${oid} kickFulfill start`);
          // kickFulfill({ ...claimedPrev, orderId: oid }, "bg_poller");
          kickFulfill(
            {
              ...claimedPrev,
              orderId: oid,
              gameType: claimedPrev.gameType,
              region: claimedPrev.region, // ✅ ADD
            },
            "bg_poller"
          );
        }
        continue;
      }

      if (isCancelTxn(txn)) {
        logLine(tag, `oid=${oid} cancelled -> set cancelled`);
        await colOrders().updateOne(
          { orderId: oid, status: { $ne: "success" } },
          {
            $set: {
              status: "cancelled",
              failed_reason: "gateway_cancelled",
              updatedAt: _now(),
            },
          }
        );
        continue;
      }

      if (isFailedTxn(txn)) {
        logLine(tag, `oid=${oid} failed -> set failed txn=${txn}`);
        await colOrders().updateOne(
          { orderId: oid, status: { $ne: "success" } },
          {
            $set: {
              status: "failed",
              payment_status: "failed",
              failed_reason: `gateway_${txn.toLowerCase()}`,
              updatedAt: _now(),
            },
          }
        );
        continue;
      }

      logLine(tag, `oid=${oid} still pending`);
    } catch (e) {
      logErr(tag, `oid=${oid} poll error`, e);
      await colOrders().updateOne(
        { orderId: oid },
        {
          $set: {
            poll_error_at: _now(),
            poll_error_msg: String(e?.response?.data || e),
          },
        }
      );
    }
  }

  logLine(tag, `batch done (${_ms(started)}ms)`);
}

async function timeoutSweep10m() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  await colOrders().updateMany(
    { payment_method: "upi", status: "pending", orderDate: { $lt: cutoff } },
    {
      $set: {
        status: "failed",
        payment_status: "failed",
        failed_reason: "timeout_10m",
        updatedAt: _now(),
      },
    }
  );
}

function startOrderPollerOnce() {
  const enabled = String(POLL_ENABLED || "true").toLowerCase() === "true";
  if (!enabled) return;
  if (global.__ORDER_BG_POLL_TIMER__) return;

  const intervalMs = Math.max(1000, Number(POLL_INTERVAL_SEC || 20) * 1000);
  console.log(
    `[orders] BG poller ON every ${intervalMs}ms (maxAge=${POLL_MAX_AGE_MIN}m)`
  );

  global.__ORDER_BG_POLL_TIMER__ = setInterval(async () => {
    try {
      await Promise.all([pollPendingOrdersBatch(), timeoutSweep10m()]);
    } catch (e) {
      console.error("[orders] BG poller error", e);
    }
  }, intervalMs);
}

startOrderPollerOnce();

module.exports = router;
