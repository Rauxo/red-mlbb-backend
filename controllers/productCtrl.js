const productModel = require("../models/productModel");
const mongoose = require("mongoose");
const fs = require("fs");
const axios = require("axios");
const querystring = require("querystring");
const md5 = require("md5");

const addProductController = async (req, res) => {
  try {
    const {
      name,
      cost,
      api,
      apiName,
      gameName,
      region,
      desc,
      gameType,
      tag,
      category,
      stock,
      packName
    } = req.body;
    // Parse the cost field as JSON
    const parsedCost = JSON.parse(cost);
    let product = await productModel.findOne({ name });
    if (product) {
      return res.status(200).send({
        success: false,
        message: "Product with this name already exists",
      });
    }
    // Create a new product if it doesn't exist
    product = new productModel({
      name,
      api,
      apiName,
      gameName,
      region,
      gameType,
      desc,
      tag,
      category,
      stock,
      packName,
      cost: parsedCost,
      image: req.file.path,
    });
    await product.save();
    return res.status(200).send({
      message: "Product added successfully",
      success: true,
    });
  } catch (error) {
    res.status(500).send({
      message: error.message,
      success: false,
    });
  }
};

const updateProductController = async (req, res) => {
  try {
    const {
      id,
      name,
      productNumber,
      packName,
      tag,
      category,
      desc,
      descTwo,
      api,
      apiName,
      gameName,
      region,
      cost,
    } = req.body;

    const product = await productModel.findOne({ _id: id });
    if (!product) {
      return res.status(200).json({
        success: false,
        message: "Failed to update",
      });
    }

    const updatedProduct = await productModel.findByIdAndUpdate(
      id,
      {
        name,
        desc,
        descTwo,
        tag,
        category,
        productNumber,
        api,
        region,
        apiName,
        gameName,
        packName,
        cost,
        image: req.file ? req.file.path : product.image,
      },
      { new: true }
    );

    await updatedProduct.save();
    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({
      success: false,
      message: "Error updating product. Please try again later.",
    });
  }
};

const getAllProductsController = async (req, res) => {
  try {
    const allProducts = await productModel.find({ isDeleted: false });
    if (allProducts.length === 0) {
      return res
        .status(200)
        .send({ success: false, message: "No Products Found" });
    }
    res.status(201).send({
      success: true,
      message: "Products Fetched Success",
      data: allProducts,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({
      success: false,
      message: `Get All Products Controller ${error.message}`,
    });
  }
};

const getProductController = async (req, res) => {
  try {
    const product = await productModel.find({ _id: req.body.id });
    if (product.length === 0) {
      return res
        .status(200)
        .send({ success: false, message: "No Product Found" });
    }
    res.status(201).send({
      success: true,
      message: "Product Fetched Success",
      data: product[0],
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({
      success: false,
      message: `Get All Products Controller ${error.message}`,
    });
  }
};

const deleteProductController = async (req, res) => {
  try {
    const { id, image } = req.body;
    const product = await productModel.findById({ _id: id });
    if (!product) {
      return res
        .status(201)
        .send({ success: false, message: "Product not found" });
    }
    const deleteProduct = await productModel.findByIdAndDelete({ _id: id });
    if (!deleteProduct) {
      return res.status(500).send({
        success: false,
        message: "Error deleting product. Please try again later.",
      });
    }
    fs.unlinkSync(image);
    return res
      .status(200)
      .send({ success: true, message: "Product Deleted Successful" });
  } catch (error) {
    res.status(500).send({
      message: `Delete Product Ctrl ${error.message}`,
      success: false,
    });
  }
};

// USER PRODUCT PAGE API'S
const getProductByCategoryController = async (req, res) => {
  try {
    const products = await productModel.find({ category: req.body.title });
    if (!products) {
      return res
        .status(200)
        .send({ success: false, message: "No Product Found" });
    }
    return res.status(200).send({
      success: true,
      message: "Product Fetched Successful",
      data: products,
    });
  } catch (error) {
    res.status(500).send({
      message: `Product By Category Ctrl ${error.message}`,
      success: false,
    });
  }
};

const getProductByNameController = async (req, res) => {
  try {
    const product = await productModel.findOne({ name: req.body.name });
    if (!product) {
      return res.status(200).send({
        success: false,
        message: "No Product Found",
      });
    }
    return res.status(201).send({
      success: true,
      message: "Product Fetched Success",
      data: product,
    });
  } catch (error) {
    res.status(500).send({
      message: `Product By Name Ctrl ${error.message}`,
      success: false,
    });
  }
};

const getMobileLegendGameController = async (req, res) => {
  try {
    const regionRaw = String(req.body?.region || "").toLowerCase().trim();
    const productRaw = String(req.body?.gameType || "").trim();

    if (!productRaw) {
      return res.status(400).json({ success: false, message: "gameType is required" });
    }

    const uid = String(process.env.UID || "").trim();
    const email = String(process.env.EMAIL || "").trim();
    const mKey = String(process.env.KEY || "").trim();

    if (!uid || !email || !mKey) {
      return res.status(500).json({
        success: false,
        message: "SmileOne env missing (UID/EMAIL/KEY). Check production env vars.",
      });
    }

    const product = productRaw.toLowerCase();

    const time = Math.floor(Date.now() / 1000);

    const signArr = { uid, email, product, time };
    const sortedSignArr = Object.fromEntries(Object.entries(signArr).sort());
    const baseStr =
      Object.keys(sortedSignArr)
        .map((k) => `${k}=${sortedSignArr[k]}`)
        .join("&");

    const strToHash = `${baseStr}&${mKey}`;
    const sign = md5(md5(strToHash));

    const formData = querystring.stringify({
      uid,
      email,
      product,
      time,
      sign,
    });

    const apiUrl =
      regionRaw === "brazil"
        ? "https://www.smile.one/br/smilecoin/api/productlist"
        : "https://www.smile.one/ph/smilecoin/api/productlist";

    const apiProduct = await axios.post(apiUrl, formData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 30000,
      validateStatus: () => true, 
    });

    const body = apiProduct.data;

    if (body?.status === 200) {
      return res.status(200).json({
        success: true,
        message: "success",
        data: body.data,
      });
    }

    console.error("SmileOne productlist failed:", {
      region: regionRaw || "ph",
      apiUrl,
      statusCode: apiProduct.status,
      body,
      debug: {
        uidLen: uid.length,
        email,
        product,
        time,
        signPreview: String(sign).slice(0, 8) + "..." + String(sign).slice(-6),
      },
    });

    return res.status(400).json({
      success: false,
      message: body?.message || "SmileOne productlist failed (sign error likely)",
      details: body,
    });
  } catch (err) {
    console.error("Error during SmileOne productlist:", err?.response?.data || err);
    return res.status(500).json({
      success: false,
      message: "Error during SmileOne productlist",
      error: err?.message,
      details: err?.response?.data,
    });
  }
};


module.exports = {
  addProductController,
  getAllProductsController,
  getProductController,
  updateProductController,
  deleteProductController,
  getProductByCategoryController,
  getProductByNameController,
  getMobileLegendGameController,
};
