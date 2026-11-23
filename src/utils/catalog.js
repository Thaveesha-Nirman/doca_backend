const { isValidConditionSlug, normalizeConditionSlug } = require("./slug");

const requiredTextFields = ["name", "slug", "summary"];
const requiredListFields = [
  "synonyms",
  "symptoms",
  "commonLocations",
  "selfCare",
  "seekMedicalCare",
];

function validateConditionCatalog(conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new Error("The condition catalog must contain at least one condition.");
  }

  const names = new Set();
  const slugs = new Set();

  conditions.forEach((condition, index) => {
    requiredTextFields.forEach((field) => {
      if (typeof condition[field] !== "string" || condition[field].trim() === "") {
        throw new Error(`Condition ${index + 1} requires a valid ${field}.`);
      }
    });

    requiredListFields.forEach((field) => {
      const values = condition[field];
      const validValues =
        Array.isArray(values) &&
        values.length > 0 &&
        values.every((value) => typeof value === "string" && value.trim() !== "");

      if (!validValues) {
        throw new Error(`Condition ${condition.slug} requires at least one ${field} value.`);
      }
    });

    const name = condition.name.trim().toLowerCase();
    const slug = normalizeConditionSlug(condition.slug);

    if (!isValidConditionSlug(slug) || slug !== condition.slug) {
      throw new Error(`Condition ${condition.name} has an invalid slug.`);
    }

    if (names.has(name)) {
      throw new Error(`Duplicate condition name: ${condition.name}.`);
    }

    if (slugs.has(slug)) {
      throw new Error(`Duplicate condition slug: ${slug}.`);
    }

    names.add(name);
    slugs.add(slug);
  });

  return true;
}

module.exports = { validateConditionCatalog };
