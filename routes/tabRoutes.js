const express = require("express");
const multer = require("multer");
const fs = require("fs");
const adminAuthMiddleware = require("../middlewares/adminAuthMiddleware");
const productModel = require("../models/productModel");
const authMiddleware = require("../middlewares/authMiddleware");

// router object
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "media/tabIcon");
  },
  filename: (req, file, cb) => {
    cb(null, "tab--" + file.originalname );
  },
});

const addTabIcon = multer({ storage: storage });

router.post("/add", addTabIcon.single('image'), async (req, res) => {

    try{
        const {
            tabName,
            productId,
            image
        } = req.body
    
        const product = await productModel.find({ _id: productId});
        if (product.length === 0) {
          return res.status(200).send({ success: false, message: "No Product Found" });
        }

        newTab = {
            "name": tabName,
            "productId": productId,
            "image": "/media/tabIcon/tab--"+ productId + "--" + tabName.replace(' ', '-') + ".jpeg"
        }

        var tabs = product[0].tabs

        tabs.push(newTab)

        const updatedProduct = await productModel.findByIdAndUpdate(
            productId,{tabs},{ new: true }
        );

        await updatedProduct.save();
        res.status(201).send({"stauts": "true"})
    }catch(error){
        console.log(error.message)
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/item-add", addTabIcon.single('image'), async (req, res) => {
    try{
        const {
            tabName,
            itemId,
            productId
        } = req.body
    
        const product = await productModel.find({ _id: productId});
        if (product.length === 0) {
          return res.status(200).send({ success: false, message: "No Product Found" });
        }

        cost = product[0].cost

        var tabExists = false
        var imageLink = ''

        product[0].tabs.forEach((tab) => {
            if(tab["name"] === tabName)
            {
                tabExists = true
                imageLink = tab["image"]
            }
        });

        if(!tabExists)
        {
            return res.status(404).json({ 'message': "Tab name not found" });
        }

        cost.forEach((item) => {

            if(itemId === item["id"])
            {
                item["tabName"] = tabName;
                item["tabImage"] = imageLink
            }
        });

        const updatedProduct = await productModel.findByIdAndUpdate(
            productId,{cost},{ new: true }
        );

        await updatedProduct.save()

        return res.status(201).send({"status": "true"})
    }catch(error){
        console.log(error.message)
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

router.delete("/",addTabIcon.single('image') , async (req, res) => {
    try {
        const { 
            productId,
            tabName
        } = req.body;

        if(tabName === "all")
        {
            return res
            .status(400)
            .send({ success: false, message: "Cannot Delete default tab" });
        }

        const product = await productModel.findById({ _id: productId });

        if (!product) {
            return res
            .status(404)
            .send({ success: false, message: "Product not found" });
        }

        var tabs = []
        var cost = []
        var tabExists = false

        product.tabs.forEach((tab) => {
            if(tab["name"] === tabName)
            {   
                tabExists = true
            }
            else{
                tabs.push(tab)
            }
        });
        if(!tabExists)
        {
            return res.status(404).json({ 'message': "Tab name not found" });
        }

        product.cost.forEach((item) => {
            if(item["tabName"] === tabName)
            {
                delete item["tabName"];
                delete item["tabImage"]
            }

            cost.push(item)
        });

        const updatedProduct = await productModel.findByIdAndUpdate(
            productId,{tabs, cost},{ new: true }
        );

        await updatedProduct.save()

        return res.status(204).send({"status": "deleted"})

    } catch (error) {
        console.log(error.message)
        return res.status(500).send({
            message: `Delete Product Ctrl ${error.message}`,
            success: false,
        });
    }
});

module.exports = router;
