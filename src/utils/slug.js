const conditionSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeConditionSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidConditionSlug(value) {
  return value.length <= 100 && conditionSlugPattern.test(value);
}

module.exports = { isValidConditionSlug, normalizeConditionSlug };
