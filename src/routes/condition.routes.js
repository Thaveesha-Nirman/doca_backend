const express = require("express");

const {
  getConditionBySlug,
  listConditions,
  searchConditions,
} = require("../controllers/condition.controller");

const router = express.Router();

router.get("/search", searchConditions);
router.get("/", listConditions);
router.get("/:slug", getConditionBySlug);

module.exports = router;
