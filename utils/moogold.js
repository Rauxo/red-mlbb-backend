"use strict";

const axios = require("axios");
const crypto = require("crypto");

const MOOGOLD_BASE_URL = (process.env.MOOGOLD_BASE_URL || "https://moogold.com").replace(/\/+$/, "");
const MOOGOLD_PARTNER_ID = (process.env.MOOGOLD_PARTNER_ID || "").trim();
const MOOGOLD_SECRET_KEY = (process.env.MOOGOLD_SECRET || process.env.MOOGOLD_SECRET_KEY || "").trim(); // match python

function requireEnv() {
  if (!MOOGOLD_PARTNER_ID) throw new Error("MOOGOLD_PARTNER_ID not configured");
  if (!MOOGOLD_SECRET_KEY) throw new Error("MOOGOLD_SECRET not configured");
}

function ts() {
  return String(Math.floor(Date.now() / 1000));
}

function basicAuthHeader() {
  const token = Buffer.from(`${MOOGOLD_PARTNER_ID}:${MOOGOLD_SECRET_KEY}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function generateAuthSignature(payloadObj, timestamp, path) {
  const payload = JSON.stringify(payloadObj);
  const stringToSign = `${payload}${timestamp}${path}`;
  return crypto.createHmac("sha256", MOOGOLD_SECRET_KEY).update(stringToSign, "utf8").digest("hex");
}

async function moogoldPost(url, path, payloadObj) {
  requireEnv();
  const timestamp = ts();
  const auth = generateAuthSignature(payloadObj, timestamp, path);

  const headers = {
    Authorization: basicAuthHeader(),
    auth,
    timestamp,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (MooGold API Client)",
  };

  const resp = await axios.post(url, payloadObj, {
    headers,
    timeout: 20000,
    validateStatus: () => true,
  });

  if (resp.status < 200 || resp.status >= 300) {
    const body = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data || {});
    throw new Error(`moogold_http_${resp.status}: ${body}`);
  }

  return resp.data;
}

async function moogoldProductDetail(product_id) {
  const url = `${MOOGOLD_BASE_URL}/wp-json/v1/api/product/product_detail`;
  const path = "product/product_detail";

  const payloadObj = {
    path,
    product_id: String(product_id),
  };

  return moogoldPost(url, path, payloadObj);
}

async function moogoldServerList(product_id) {
  const url = `${MOOGOLD_BASE_URL}/wp-json/v1/api/product/server_list`;
  const path = "product/server_list";

  const payloadObj = {
    path,
    product_id: String(product_id),
  };

  try {
    return await moogoldPost(url, path, payloadObj);
  } catch (e) {
    const payloadObj2 = {
      path,
      data: { category: "1", "product-id": String(product_id) },
    };
    return await moogoldPost(url, path, payloadObj2);
  }
}

async function moogoldCreateOrder({ category = "1", product_id, quantity = 1, user_id, zone_id, partner_order_id }) {
  const url = `${MOOGOLD_BASE_URL}/wp-json/v1/api/order/create_order`;
  const path = "order/create_order";

  const payloadObj = {
    path,
    data: {
      category: String(category),
      "product-id": String(product_id),
      quantity: Number(quantity),
      "User ID": String(user_id),
      "Server ID": String(zone_id),
    },
    partnerOrderId: String(partner_order_id),
  };

  return moogoldPost(url, path, payloadObj);
}

module.exports = {
  moogoldProductDetail,
  moogoldServerList,
  moogoldCreateOrder,
};
