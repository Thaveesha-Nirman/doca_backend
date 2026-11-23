const mongoose = require("mongoose");

const Condition = require("../models/condition.model");
const { MEDICAL_DISCLAIMER } = require("../constants/medical");
const ApiError = require("../utils/apiError");
const { parsePagination, parseResultLimit } = require("../utils/query");
const { buildConditionSearchFilter, normalizeSearchQuery } = require("../utils/search");
const { isValidConditionSlug, normalizeConditionSlug } = require("../utils/slug");

function requireDatabase() {
  if (mongoose.connection.readyState !== 1) {
    throw new ApiError(503, "Database unavailable. Start MongoDB and try again.");
  }
}

async function listConditions(req, res) {
  const { page, limit, skip } = parsePagination(req.query);
  requireDatabase();

  const [conditions, total] = await Promise.all([
    Condition.find().sort({ name: 1 }).skip(skip).limit(limit).lean(),
    Condition.countDocuments(),
  ]);

  res.json({
    data: conditions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    disclaimer: MEDICAL_DISCLAIMER,
  });
}

async function getConditionBySlug(req, res) {
  const slug = normalizeConditionSlug(req.params.slug);

  if (!isValidConditionSlug(slug)) {
    throw new ApiError(400, "Condition slug is invalid.");
  }

  requireDatabase();
  const condition = await Condition.findOne({ slug }).lean();

  if (!condition) {
    throw new ApiError(404, "Condition not found.");
  }

  res.json({ data: condition, disclaimer: MEDICAL_DISCLAIMER });
}

async function searchConditions(req, res) {
  if (typeof req.query.q !== "string") {
    throw new ApiError(400, "Query parameter q must contain at least 2 characters.");
  }

  const query = normalizeSearchQuery(req.query.q);

  if (query.length < 2) {
    throw new ApiError(400, "Query parameter q must contain at least 2 characters.");
  }

  const limit = parseResultLimit(req.query.limit);
  requireDatabase();
  const conditions = await Condition.find(buildConditionSearchFilter(query))
    .sort({ name: 1 })
    .limit(limit)
    .lean();

  res.json({
    query,
    count: conditions.length,
    data: conditions,
    disclaimer: MEDICAL_DISCLAIMER,
  });
}

module.exports = { getConditionBySlug, listConditions, searchConditions };
