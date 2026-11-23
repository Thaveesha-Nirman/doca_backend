const mongoose = require("mongoose");

const Condition = require("../models/condition.model");
const { MEDICAL_DISCLAIMER } = require("../constants/medical");
const ApiError = require("../utils/apiError");
const { buildConditionSearchFilter, normalizeSearchQuery } = require("../utils/search");

function requireDatabase() {
  if (mongoose.connection.readyState !== 1) {
    throw new ApiError(503, "Database unavailable. Start MongoDB and try again.");
  }
}

function parsePagination(query) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 20, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
}

async function listConditions(req, res) {
  requireDatabase();
  const { page, limit, skip } = parsePagination(req.query);

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
  requireDatabase();
  const condition = await Condition.findOne({ slug: req.params.slug.toLowerCase() }).lean();

  if (!condition) {
    throw new ApiError(404, "Condition not found.");
  }

  res.json({ data: condition, disclaimer: MEDICAL_DISCLAIMER });
}

async function searchConditions(req, res) {
  const query = normalizeSearchQuery(req.query.q);

  if (query.length < 2) {
    throw new ApiError(400, "Query parameter q must contain at least 2 characters.");
  }

  requireDatabase();
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
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
