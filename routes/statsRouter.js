const express = require("express");
const orderModel = require("../models/orderModel");
const userModel = require("../models/userModel");


// router object
const router = express.Router();

router.get("/users",  async (req, res) => {
    try{
        let count = await userModel.countDocuments(); console.log(count);

        count = count + 1000;
        return res.json({"users": count})
    }catch(error){
        console.log(error.message)
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

router.get("/orders",  async (req, res) => {
    try{
        let count = await orderModel.countDocuments(); console.log(count);

        count = count + 40000;
        return res.json({"orders": count})
    }catch(error){
        console.log(error.message)
        return res.status(500).json({ error: "Internal Server Error" });
    }
});


module.exports = router;
