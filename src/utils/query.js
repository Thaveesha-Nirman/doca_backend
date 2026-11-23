const ApiError = require("./apiError");

function parsePositiveInteger(value, { defaultValue, field, max }) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const input = String(value);
  if (!/^\d+$/.test(input)) {
    throw new ApiError(400, `${field} must be a positive integer.`);
  }

  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ApiError(400, `${field} must be a positive integer.`);
  }

  if (max && parsed > max) {
    throw new ApiError(400, `${field} cannot be greater than ${max}.`);
  }

  return parsed;
}

function parsePagination(query) {
  const page = parsePositiveInteger(query.page, {
    defaultValue: 1,
    field: "page",
  });
  const limit = parsePositiveInteger(query.limit, {
    defaultValue: 20,
    field: "limit",
    max: 50,
  });

  return { page, limit, skip: (page - 1) * limit };
}

function parseResultLimit(value) {
  return parsePositiveInteger(value, {
    defaultValue: 20,
    field: "limit",
    max: 50,
  });
}

module.exports = { parsePagination, parsePositiveInteger, parseResultLimit };
