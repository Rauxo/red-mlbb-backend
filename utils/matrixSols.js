const crypto = require('crypto');
const axios = require('axios');

// Recursively sort object keys alphabetically (required for signature)
function sortObjectKeys(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortObjectKeys);
    return Object.keys(obj)
        .sort()
        .reduce((sorted, key) => {
            sorted[key] = sortObjectKeys(obj[key]);
            return sorted;
        }, {});
}

// Generate HMAC‑SHA256 signature
function generateSignature(payload, apiKey) {
    const sortedPayload = sortObjectKeys(payload);
    const serializedBody = JSON.stringify(sortedPayload);
    const hmac = crypto.createHmac('sha256', apiKey);
    hmac.update(serializedBody);
    return hmac.digest('hex');
}

// Generic request wrapper
async function request(endpoint, payload, clientId, apiKey) {
    const signature = generateSignature(payload, apiKey);
    const url = `https://matrixsols.in/api/digital-top-ups/${endpoint}`;
    const response = await axios.post(url, payload, {
        headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': clientId,
            'X-Signature': signature,
        },
        timeout: 15000,
    });
    if (response.data.status !== 200) {
        throw new Error(response.data.message || `Matrix Sols error: ${response.status}`);
    }
    return response.data;
}

// Exported API functions
async function getWalletBalance() {
    const payload = {};
    return request('balance/', payload, process.env.MATRIX_SOLS_CLIENT_ID, process.env.MATRIX_SOLS_API_KEY);
}

async function listProducts(category) {
    const payload = { category };
    return request('products_list/', payload, process.env.MATRIX_SOLS_CLIENT_ID, process.env.MATRIX_SOLS_API_KEY);
}

async function getProductDetails(productId) {
    const payload = { product_id: String(productId) };
    return request('product_items_list/', payload, process.env.MATRIX_SOLS_CLIENT_ID, process.env.MATRIX_SOLS_API_KEY);
}

async function getProductServerList(productId) {
    const payload = { product_id: String(productId) };
    return request('product_server_list/', payload, process.env.MATRIX_SOLS_CLIENT_ID, process.env.MATRIX_SOLS_API_KEY);
}

async function checkId(productId, userId, server = '', serverRegion = '') {
    const payload = { product_id: String(productId), user_id: String(userId) };
    if (server) payload.server = server;
    if (serverRegion) payload.server_region = serverRegion;
    return request('check_id/', payload, process.env.MATRIX_SOLS_CLIENT_ID, process.env.MATRIX_SOLS_API_KEY);
}

async function createOrder(itemId, userId, server = '', serverRegion = '') {
    const payload = { item_id: String(itemId), user_id: String(userId) };
    if (server) payload.server = server;
    if (serverRegion) payload.server_region = serverRegion;
    return request('create_order/', payload, process.env.MATRIX_SOLS_CLIENT_ID, process.env.MATRIX_SOLS_API_KEY);
}

async function trackOrder(orderId) {
    const payload = { order_id: String(orderId) };
    return request('order_details/', payload, process.env.MATRIX_SOLS_CLIENT_ID, process.env.MATRIX_SOLS_API_KEY);
}

module.exports = {
    listProducts,
    getProductDetails,
    getProductServerList,
    checkId,
    createOrder,
    trackOrder,
    getWalletBalance,
};