function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchQuery(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function buildConditionSearchFilter(query) {
  const terms = normalizeSearchQuery(query)
    .split(" ")
    .filter(Boolean)
    .slice(0, 10);

  return {
    $and: terms.map((term) => {
      const pattern = new RegExp(escapeRegex(term), "i");

      return {
        $or: [
          { name: pattern },
          { summary: pattern },
          { synonyms: pattern },
          { symptoms: pattern },
          { commonLocations: pattern },
        ],
      };
    }),
  };
}

module.exports = { buildConditionSearchFilter, normalizeSearchQuery };
