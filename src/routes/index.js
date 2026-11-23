const express = require("express");

const { getApiInfo } = require("../controllers/api.controller");
const { getHealth } = require("../controllers/health.controller");
const conditionRoutes = require("./condition.routes");

const router = express.Router();

router.get("/", getApiInfo);
router.get("/health", getHealth);
router.use("/conditions", conditionRoutes);

module.exports = router;
