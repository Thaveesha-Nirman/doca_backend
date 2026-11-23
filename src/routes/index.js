const express = require("express");

const conditionRoutes = require("./condition.routes");

const router = express.Router();

router.use("/conditions", conditionRoutes);

module.exports = router;
