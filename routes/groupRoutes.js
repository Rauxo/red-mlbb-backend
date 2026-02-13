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
    cb(null, "media/groupIcon");
  },
  filename: (req, file, cb) => {
    cb(null, "group--" + file.originalname );
  },
});

const addGroupIcon = multer({ storage: storage });

router.post("/add",adminAuthMiddleware, addGroupIcon.single('image'), async (req, res) => {
    try{
        const {
            groupName,
            productId,
            image
        } = req.body
    
        const product = await productModel.find({ _id: productId});
        if (product.length === 0) {
          return res.status(200).send({ success: false, message: "No Product Found" });
        }

        newGroup = {
            "name": groupName,
            "productId": productId,
            "image": "/media/groupIcon/group--"+ productId + "--" + groupName.replace(' ', '-') + ".jpeg"
        }

        var groups = product[0].groups

        groups.push(newGroup)

        const updatedProduct = await productModel.findByIdAndUpdate(
            productId,{groups},{ new: true }
        );

        await updatedProduct.save();
        res.status(201).send({"stauts": "true"})
    }catch(error){
        console.log(error.message)
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/item-add",adminAuthMiddleware, addGroupIcon.single('image'), async (req, res) => {
    try{
        const {
            groupName,
            itemId,
            productId
        } = req.body
    
        const product = await productModel.find({ _id: productId});
        if (product.length === 0) {
          return res.status(200).send({ success: false, message: "No Product Found" });
        }

        cost = product[0].cost

        var groupExists = false
        var imageLink = ''

        product[0].groups.forEach((group) => {
            if(group["name"] === groupName)
            {
                groupExists = true
                imageLink = group["image"]
            }
        });

        if(!groupExists)
        {
            return res.status(404).json({ 'message': "Group name not found" });
        }

        cost.forEach((item) => {

            if(itemId === item["id"])
            {
                item["groupName"] = groupName;
                item["image"] = imageLink
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

router.delete("/", adminAuthMiddleware, addGroupIcon.single('image'), async (req, res) => {
    try {
        const { 
            productId,
            groupName
        } = req.body;

        if(groupName === "all")
        {
            return res
            .status(400)
            .send({ success: false, message: "Cannot Delete default group" });
        }

        const product = await productModel.findById({ _id: productId });

        if (!product) {
            return res
            .status(404)
            .send({ success: false, message: "Product not found" });
        }

        var groups = []
        var cost = []
        var groupExists = false

        product.groups.forEach((group) => {
            if(group["name"] === groupName)
            {   
                groupExists = true
            }
            else{
                groups.push(group)
            }
        });
        if(!groupExists)
        {
            return res.status(404).json({ 'message': "Group name not found" });
        }

        product.cost.forEach((item) => {
            if(item["groupName"] === groupName)
            {
                delete item["groupName"];
                delete item["image"]
            }

            cost.push(item)
        });

        const updatedProduct = await productModel.findByIdAndUpdate(
            productId,{groups, cost},{ new: true }
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
