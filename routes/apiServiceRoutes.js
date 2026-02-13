const express = require("express");
const axios = require("axios");
const base64 = require("base-64");
const router = express.Router();
const fetch = require("node-fetch");
const crypto = require("node:crypto");
const { moogoldProductDetail, moogoldServerList } = require("../utils/moogold");


// const crypto = require("crypto");

function yanjieSignature(apiId, apiKey) {
  return crypto
    .createHash("md5")
    .update(String(apiId) + String(apiKey))
    .digest("hex");
}
router.post("/profile", async (req, res) => {
  try {
    const api_id = process.env.YANJIE_API_ID;
    const api_key = process.env.YANJIE_API_KEY;

    const payload = {
      api_id,
      api_key,
      signature: yanjieSignature(api_id, api_key),
    };

    const r = await axios.post(
      "https://yanjiestore.com/api/profile",
      payload,
      { timeout: 15000 }
    );

    if (!r.data?.result) {
      return res.status(400).json({
        success: false,
        message: r.data?.msg || "Profile fetch failed",
      });
    }

    return res.json({
      success: true,
      data: r.data.data, // username, balance, role
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message,
    });
  }
});

router.post("/cek-nickname", async (req, res) => {
  try {
    const { userid, zoneid, kode } = req.body || {};
    if (!userid || !kode) {
      return res.status(400).json({
        success: false,
        message: "userid and kode required",
      });
    }

    const payload = {
      api_key: process.env.YANJIE_API_KEY,
      id: String(userid),
      server: zoneid ? String(zoneid) : undefined,
      kode: String(kode),
    };

    const r = await axios.post(
      "https://yanjiestore.com/api/cek",
      payload,
      { timeout: 15000 }
    );

    if (r.data?.status === true) {
      return res.json({
        success: true,
        data: {
          username: r.data.nickname,
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: r.data?.msg || "Nickname check failed",
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message,
    });
  }
});


router.post("/moogold/product-detail", express.json(), async (req, res) => {
  try {
    const product_id = String(req.body?.product_id || "").trim();
    if (!product_id) return res.status(400).json({ success: false, message: "product_id required" });

    const data = await moogoldProductDetail(product_id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: String(e.message || e) });
  }
});

router.post("/moogold/server-list", express.json(), async (req, res) => {
  try {
    const product_id = String(req.body?.product_id || "").trim();
    if (!product_id) return res.status(400).json({ success: false, message: "product_id required" });

    const data = await moogoldServerList(product_id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: String(e.message || e) });
  }
});


////////  yokas   ////////////

const yokcashHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "WuruStore-Server/1.0",
};

function normalizeRegion(region) {
  const r = String(region || "").toLowerCase().trim();
  if (!r) return "global";
  if (r === "ph" || r === "phil" || r === "philippines") return "philippines";
  if (r === "sg" || r === "singapore") return "singapore";
  if (r === "id" || r === "indo" || r === "indonesia") return "indonesia";
  if (r === "my" || r === "malaysia") return "malaysia";
  if (r === "br" || r === "brazil") return "brazil";
  if (r === "ru" || r === "russia") return "russia";
  if (r === "tr" || r === "turkey") return "turkey";
  if (r === "pk" || r === "pakistan") return "pakistan";
  if (r === "bd" || r === "bangladesh") return "bangladesh";
  return r; 
}

router.post("/get-yokcash", async (req, res) => {
  try {
    const { gameName, region } = req.body || {};

    const normalizedGameName = String(gameName || "").toLowerCase().trim();
    if (!normalizedGameName) {
      return res.status(400).json({ success: false, message: "gameName is required" });
    }

    const apiKey = String(process.env.YOK_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: "Server misconfig: YOK_API_KEY missing in env",
      });
    }

    const url = "https://api.yokcash.com/service";

    const requestBody = { api_key: apiKey };

    const response = await fetch(url, {
      method: "POST",
      headers: yokcashHeaders,
      body: JSON.stringify(requestBody),
    });

    const rawText = await response.text(); 
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      data = { raw: rawText };
    }

    if (!response.ok) {
      console.error("Yokcash API HTTP error:", {
        status: response.status,
        statusText: response.statusText,
        body: data,
      });

      return res.status(response.status).json({
        success: false,
        message: "Yokcash API error",
        status: response.status,
        statusText: response.statusText,
        details: data,  
      });
    }

    if (!data?.status) {
      console.error("Yokcash status=false:", data);
      return res.status(400).json({
        success: false,
        message: data?.msg || "Failed to fetch Yokcash services",
        details: data,
      });
    }

    const supportedGames = {
      "mobile legends": ["mobile legends", "mlbb"],
      "genshin impact": ["genshin impact"],
      "honkai star rail": ["honkai star rail"],
      "honor of kings": ["honor of kings"],
    };

    if (!supportedGames[normalizedGameName]) {
      return res.status(400).json({
        success: false,
        message: `Unsupported game: ${gameName}`,
        supported: Object.keys(supportedGames),
      });
    }

    const regionPatterns = {
      "mobile legends": {
        global: [
          /^ML\d+$/,
          /^ML\d+[A-Z]*$/,
          /^MLYC\d+$/,
          /^\d+$/,
          /^ML[A-Z]+\d+$/,
          /^ML[A-Z]+\d+[A-Z]*$/,
          /^FTMLYCGB\d+$/,
          /^MLGLB\d+YCGG$/,
          /^WDPX\d+GLBYCGG$/,
          /^ML\d+GLB\d+$/,
          /^MLWDPGLB2$/,
          /^ML\d+GLB2$/,
          /^MLGLB\d+YCGG$/,
          /^TPGLBGLBYCGG$/,
        ],
        indonesia: [
          /^\d+$/,
          /^ML\d+YC[A-Z]*$/,
          /^ML\d+$/,
          /^MLYC\d+$/,
          /^ML\d+YCBPK$/,
          /^ML\d+YCDG$/,
          /^ML\d+PROMOYC$/,
          /^MLBB\d+YCBPK$/,
          /^ML\d+YC[A-Z]+$/,
          /^FT\d+YCAUTO$/,
          /^YCTWILIGHTPASS$/,
          /^promowdpyc$/,
          /^wdpycx\d+$/,
          /^WDPMANUAL$/,
          /^ML\d+YC[A-Z]*\d*$/,
        ],
        russia: [/^MLYCRU\d+$/, /YCRU/, /^MLYCRU/, /^MLYCRUWDP$/, /^MLYCRUTP$/],
        singapore: [/YCSGP$/, /_YCSGP$/, /^ML\d+_+\d+YCSGP$/],
        philippines: [
          /PH$/,
          /YCPH$/,
          /PHYC/,
          /^ML\d+PH$/,
          /ML\d+FTYCPH$/,
          /MLWDPPHYC$/,
          /MLSVPFTYCPH$/,
          /MLWEEKLYDIAMONDPASS\d+YC_PH$/,
          /TWPASSSPHYC$/,
        ],
        malaysia: [
          /MY$/,
          /YCMY$/,
          /MYYC/,
          /^ML\d+MY$/,
          /ML\d+FTPYCMY$/,
          /WDPMYYC$/,
          /ML\d+MYYCFTP$/,
          /TWPASSYCMY$/,
          /MLCOUPONPASSMY$/,
        ],
        turkey: [/TY/, /MLTY\d+YC$/, /TYWDPYC$/, /MLTYWDPYC$/, /^MLTY\d+YC$/],
        brazil: [/BR/, /BRYC$/, /FTMLYCBR\d+$/, /WDPBRYC$/, /FTMLYCBRSVP$/, /^\d+BRYC$/],
        pakistan: [/BPK/, /YCBPK$/, /ML\d+YCBPK$/],
        bangladesh: [/BD/, /YCBG/],
      },
      "genshin impact": {
        global: [
          /^GIYC\d+$/,
          /^GENSHIN\d+YC_ID_GG$/,
          /^GENSHINBS\d*YC_ID_GG$/,
          /^GIYCW\d*$/,
          /^GIBUNDLE\d+YC$/,
          /^GIYCALL$/,
          /^GIYC\d+GG$/,
        ],
        indonesia: [/^GI\d+CN_YC$/, /^GI\d+YCMRH$/, /^GIWELKINYCMRH$/],
      },
      "honkai star rail": {
        global: [
          /^HNKIYC\d+$/,
          /^HSTR\d+YCS1$/,
          /^HSTRESPX?\d*YCS1$/,
          /^HSTRHC\d+YC$/,
          /^HSTRPCK\d+YC$/,
          /^HNKIYCALL$/,
          /^HSTRHC\d+YCGG$/,
        ],
      },
      "honor of kings": {
        global: [
          /^HOKYC\d+$/,
          /^HOK\d+PROMO$/,
          /^HOKYCWEEKLY$/,
          /^HOKWCPYCX$/,
          /^HOK\d+PROMO$/,
        ],
      },
    };

    const selectedRegion = normalizeRegion(region);
    const gameAliases = supportedGames[normalizedGameName];
    const gamePatterns = regionPatterns[normalizedGameName];

    const services = Array.isArray(data?.data) ? data.data : [];
    const filteredGames = services.filter((service) => {
      const kategori = String(service?.kategori || "").toLowerCase();
      const sid = String(service?.id || "");

      if (!kategori || !sid) return false;

      const isGameMatch = gameAliases.some((alias) => kategori.includes(alias));
      if (!isGameMatch) return false;

      if (selectedRegion && selectedRegion !== "global" && gamePatterns?.[selectedRegion]) {
        return gamePatterns[selectedRegion].some((pattern) => pattern.test(sid));
      }

      if (gamePatterns?.global) {
        return gamePatterns.global.some((pattern) => pattern.test(sid));
      }

      return true;
    });

    if (!filteredGames.length) {
      return res.status(404).json({
        success: false,
        message: `No products found for ${gameName} in region: ${selectedRegion}`,
      });
    }

    console.log(`Yokcash filtered: ${filteredGames.length}`, {
      gameName: normalizedGameName,
      region: selectedRegion,
      sample: {
        id: filteredGames[0].id,
        kategori: filteredGames[0].kategori,
        layanan: filteredGames[0].layanan,
      },
    });

    return res.status(200).json({
      success: true,
      message: `${gameName} Services Fetched Successfully`,
      data: filteredGames,
      region: selectedRegion,
      count: filteredGames.length,
    });
  } catch (error) {
    console.error("Error in /get-yokcash:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});


//////   smile  ///////

const SMILE_BASE = "https://www.smile.one/br";
const SMILE_BASE_PH = "https://www.smile.one/ph";
const SMILE_UID = process.env.UID;
const SMILE_EMAIL = process.env.EMAIL;
const SMILE_KEY = process.env.KEY;

function smileSign(pairs) {
  const keys = Object.keys(pairs).sort();
  const body = keys.map((k) => `${k}=${pairs[k]}`).join("&") + "&" + SMILE_KEY;
  const md1 = crypto.createHash("md5").update(body, "utf8").digest("hex");
  const md2 = crypto.createHash("md5").update(md1, "utf8").digest("hex");
  return md2;
}

function smileForm(baseParams = {}) {
  const time = Math.floor(Date.now() / 1000); // valid ~5 minutes
  const params = {
    email: SMILE_EMAIL,
    uid: SMILE_UID,
    time,
    ...baseParams,
  };
  params.sign = smileSign(params);
  const form = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) =>
    form.append(k, String(v ?? ""))
  );
  return form;
}

function assertSmileEnv() {
  if (!SMILE_BASE) throw new Error("SMILE_BASE not configured");
  if (!SMILE_UID) throw new Error("SMILE_UID not configured");
  if (!SMILE_EMAIL) throw new Error("SMILE_EMAIL not configured");
  if (!SMILE_KEY) throw new Error("SMILE_KEY not configured");
}

async function smilePost(path, form, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    assertSmileEnv();
    const url = `${SMILE_BASE}/smilecoin/api/${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function smilePostPH(path, form, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    assertSmileEnv();
    if (!SMILE_BASE_PH) {
      throw new Error("SMILE_BASE_PH not configured");
    }
    const url = `${SMILE_BASE_PH}/smilecoin/api/${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

router.post("/getrole_br", async (req, res) => {
  try {
    const { userid, zoneid, product, productid } = req.body || {};
    if (!userid || !product || !productid) {
      return res.status(400).send({
        success: false,
        message: "userid, product, and productid are required",
      });
    }
    const z = zoneid || userid;
    const form = smileForm({ userid, zoneid: z, product, productid });
    const json = await smilePost("getrole", form);

    return res.status(200).send({
      success: true,
      message: "role fetched",
      data: json,
    });
  } catch (e) {
    return res.status(500).send({
      success: false,
      message: `role error: ${e.message}`,
    });
  }
});


router.post("/getrole_ph", async (req, res) => {
  try {
    const { userid, zoneid } = req.body || {};
    if (!userid || !zoneid) {
      return res.status(400).send({
        success: false,
        message: "userid and zoneid are required",
      });
    }

    const z = zoneid || userid;
    const fixedProductId = 213;
    const fixedProduct = "mobilelegends";
    const form = smileForm({
      userid,
      zoneid: z,
      product: fixedProduct,
      productid: fixedProductId,
    });

    const json = await smilePostPH("getrole", form);

    return res.status(200).send({
      success: true,
      message: "role fetched",
      productid: fixedProductId,
      data: json,
    });
  } catch (e) {
    return res.status(500).send({
      success: false,
      message: `role error: ${e.message}`,
    });
  }
});


module.exports = router;
