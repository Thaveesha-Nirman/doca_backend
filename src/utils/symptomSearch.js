const STOP_WORDS = new Set([
  "i", "im", "ive", "my", "me", "the", "a", "an", "on", "in", "at", "of",
  "to", "for", "and", "or", "is", "are", "was", "were", "be", "been", "with",
  "it", "its", "this", "that", "these", "those", "have", "has", "had", "got",
  "getting", "very", "really", "super", "some", "just", "from", "since",
  "about", "like", "days", "day", "week", "weeks", "month", "months", "help",
  "please", "anyone", "know", "what", "could", "skin",
]);

// Bidirectional dermatology & everyday symptom/area synonym groups
const SYNONYM_GROUPS = [
  ["itch", "itchy", "itching", "pruritus", "scratch", "scratching"],
  ["red", "redness", "erythema", "inflamed", "inflammation", "pink", "flushed"],
  [
    "bump", "bumps", "pimple", "pimples", "acne", "zit", "zits", "breakout",
    "breakouts", "pustule", "pustules", "whitehead", "blackhead", "papule",
    "cystic", "comedone",
  ],
  [
    "dry", "dryness", "flaky", "flaking", "flakes", "scaly", "scales",
    "peel", "peeling", "rough", "cracked", "eczema", "psoriasis", "dandruff",
    "dermatitis",
  ],
  ["rash", "rashes", "patch", "patches", "blotch", "blotches", "spot", "spots"],
  ["ring", "ringworm", "tinea", "circular", "round", "fungal", "fungus"],
  ["hive", "hives", "welt", "welts", "urticaria", "allergy", "allergic"],
  ["swell", "swelling", "swollen", "puffy", "edema", "lump"],
  [
    "blister", "blisters", "vesicle", "vesicles", "fluid", "ooze", "oozing",
    "weeping", "crust", "crusting", "pus", "shingles", "herpes",
  ],
  ["pain", "painful", "burn", "burning", "sting", "stinging", "tender", "sore"],
  [
    "dark", "hyperpigmentation", "pigment", "pigmentation", "melasma",
    "scar", "scars", "mark", "marks", "discoloration", "brown",
  ],
  ["white", "pale", "vitiligo", "hypopigmentation", "versicolor"],
  ["bite", "bites", "bug", "mosquito", "flea", "bedbug", "insect"],
  ["face", "facial", "cheek", "cheeks", "forehead", "chin", "jaw", "nose"],
  ["scalp", "head", "hairline"],
  ["arm", "arms", "forearm", "elbow", "hand", "hands", "finger", "fingers", "wrist"],
  ["leg", "legs", "thigh", "knee", "shin", "foot", "feet", "ankle", "toe", "toes"],
  ["back", "chest", "torso", "stomach", "abdomen", "shoulder", "shoulders"],
  ["neck", "throat", "collarbone"],
];

// Preset UI chip keys -> search concepts
const SYMPTOM_CHIP_TERMS = {
  itchy: ["itch", "itchy", "itching", "scratch"],
  redness: ["red", "redness", "inflamed", "rash"],
  bumps: ["bump", "bumps", "acne", "pimple", "breakout", "pustule"],
  dry_flaky: ["dry", "flaky", "scaly", "peeling", "eczema", "psoriasis"],
  blisters: ["blister", "fluid", "vesicle", "shingles"],
  ring_rash: ["ring", "ringworm", "tinea", "circular", "fungal"],
  painful: ["pain", "painful", "burning", "stinging", "tender", "sore"],
  dark_spots: ["dark", "hyperpigmentation", "melasma", "scar", "marks"],
  swelling: ["swell", "swelling", "swollen", "hives", "welt"],
  oozing: ["oozing", "weeping", "crust", "pus", "fluid"],
};

const BODY_AREA_TERMS = {
  face: ["face", "facial", "cheek", "forehead", "chin", "jaw", "nose"],
  scalp: ["scalp", "head", "hairline", "dandruff"],
  arms_hands: ["arm", "forearm", "elbow", "hand", "finger", "wrist"],
  legs_feet: ["leg", "thigh", "knee", "shin", "foot", "feet", "ankle", "toe"],
  back_chest: ["back", "chest", "torso", "stomach", "shoulder"],
  neck: ["neck", "throat", "collarbone"],
};

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function basicStem(word) {
  if (word.length <= 4) return word;
  if (word.endsWith("ing") && word.length >= 6) return word.slice(0, -3);
  if (word.endsWith("ness") && word.length >= 7) return word.slice(0, -4);
  if (word.endsWith("ies") && word.length >= 5) return word.slice(0, -3) + "y";
  if (word.endsWith("es") && word.length >= 5) return word.slice(0, -2);
  if (word.endsWith("ed") && word.length >= 5) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length >= 5) {
    return word.slice(0, -1);
  }
  return word;
}

function getSynonymsFor(token) {
  const stem = basicStem(token);
  const related = new Set();

  for (const group of SYNONYM_GROUPS) {
    const hitsGroup = group.some(
      (g) => g === token || g === stem || basicStem(g) === stem
    );
    if (hitsGroup) {
      for (const g of group) {
        if (g !== token) related.add(g);
      }
    }
  }
  return [...related];
}

function tokenizeQuery(rawQuery) {
  const cleaned = (rawQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const meaningful = cleaned.filter((w) => !STOP_WORDS.has(w));
  return [...new Set(meaningful.length > 0 ? meaningful : cleaned)].slice(0, 8);
}

function parseSearchFilters(query = {}) {
  const q = (query.q || "").toString().trim();
  const status = (query.status || "").toString().trim();
  const bodyArea = (query.bodyArea || "").toString().trim().toLowerCase();
  const hasPhotos = query.hasPhotos === "true";
  const onlyJourneys = query.onlyJourneys === "true";
  const sort = (query.sort || "").toString().trim();

  const rawSymptoms = (query.symptoms || "").toString().trim();
  const symptoms = rawSymptoms
    ? rawSymptoms
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => Boolean(SYMPTOM_CHIP_TERMS[s]))
    : [];

  const tokens = tokenizeQuery(q);
  const hasTextOrSymptomCriteria =
    tokens.length > 0 || symptoms.length > 0 || Boolean(BODY_AREA_TERMS[bodyArea]);

  const hasAnyFilter =
    hasTextOrSymptomCriteria ||
    ["Asking", "Ongoing", "Healed"].includes(status) ||
    hasPhotos ||
    onlyJourneys;

  const effectiveSort =
    sort || (hasTextOrSymptomCriteria ? "relevance" : "newest");

  return {
    q,
    tokens,
    status: ["Asking", "Ongoing", "Healed"].includes(status) ? status : "",
    symptoms,
    bodyArea: BODY_AREA_TERMS[bodyArea] ? bodyArea : "",
    hasPhotos,
    onlyJourneys,
    sort: effectiveSort,
    hasTextOrSymptomCriteria,
    hasAnyFilter,
  };
}

function wordPrefixMatches(text, term) {
  if (!text || !term) return false;
  const rx = new RegExp(`\\b${escapeRegex(term)}`, "i");
  return rx.test(text);
}

function evaluatePostMatch(post, totalSteps, filters, shareCaption = "") {
  // 1. Hard structured filters
  if (filters.status && post.status !== filters.status) {
    return null;
  }
  if (filters.hasPhotos && (!Array.isArray(post.images) || post.images.length === 0)) {
    return null;
  }
  if (filters.onlyJourneys && totalSteps <= 1) {
    return null;
  }

  const title = (post.title || "").toString();
  const body = `${post.body || ""} ${shareCaption || ""}`;

  // If no text/symptom/area criteria, pass straight through with neutral score
  if (!filters.hasTextOrSymptomCriteria) {
    return { score: 0, matchedTerms: [] };
  }

  let score = 0;
  const matchedTerms = [];

  // 2. Body Area check (if explicitly selected, require match for high accuracy)
  if (filters.bodyArea) {
    const areaTerms = BODY_AREA_TERMS[filters.bodyArea] || [];
    const hitTitle = areaTerms.find((t) => wordPrefixMatches(title, t));
    const hitBody = areaTerms.find((t) => wordPrefixMatches(body, t));
    if (!hitTitle && !hitBody) {
      return null;
    }
    score += hitTitle ? 22 : 14;
    matchedTerms.push(hitTitle || hitBody);
  }

  // 3. Build search concepts from typed query + selected symptom chips
  const concepts = [];

  for (const token of filters.tokens) {
    concepts.push({
      label: token,
      primary: [token, basicStem(token)],
      synonyms: getSynonymsFor(token),
    });
  }

  for (const symKey of filters.symptoms) {
    const terms = SYMPTOM_CHIP_TERMS[symKey] || [];
    concepts.push({
      label: symKey.replace("_", " "),
      primary: terms,
      synonyms: terms.flatMap((t) => getSynonymsFor(t)),
    });
  }

  if (concepts.length > 0) {
    let matchedConcepts = 0;

    for (const concept of concepts) {
      const uniquePrimary = [...new Set(concept.primary)];
      const uniqueSyns = [...new Set(concept.synonyms)];

      const directTitle = uniquePrimary.find((t) => wordPrefixMatches(title, t));
      const directBody = uniquePrimary.find((t) => wordPrefixMatches(body, t));

      if (directTitle || directBody) {
        matchedConcepts += 1;
        if (directTitle) score += 20;
        if (directBody) score += 10;
        if (!matchedTerms.includes(concept.label)) {
          matchedTerms.push(concept.label);
        }
        continue;
      }

      const synTitle = uniqueSyns.find((t) => wordPrefixMatches(title, t));
      const synBody = uniqueSyns.find((t) => wordPrefixMatches(body, t));

      if (synTitle || synBody) {
        matchedConcepts += 1;
        if (synTitle) score += 12;
        if (synBody) score += 6;
        const foundWord = synTitle || synBody;
        if (!matchedTerms.includes(foundWord)) {
          matchedTerms.push(foundWord);
        }
      }
    }

    if (matchedConcepts === 0) {
      return null;
    }

    // Exact phrase boost for multi-word queries
    if (filters.tokens.length >= 2 && filters.q.length >= 4) {
      const phraseRx = new RegExp(escapeRegex(filters.q), "i");
      if (phraseRx.test(title)) score += 30;
      else if (phraseRx.test(body)) score += 15;
    }

    // Coverage bonus: strongly reward posts matching ALL user symptoms
    const coverageRatio = matchedConcepts / concepts.length;
    score += Math.round(coverageRatio * 25);

    // Subtle community quality boost (upvotes + complete journeys)
    const votes =
      (Array.isArray(post.upvotedBy) ? post.upvotedBy.length : 0) -
      (Array.isArray(post.downvotedBy) ? post.downvotedBy.length : 0);
    if (votes > 0) score += Math.min(votes, 15) * 0.5;
    if (totalSteps > 1) score += 4;
  }

  return {
    score: Math.round(score),
    matchedTerms: matchedTerms.slice(0, 4),
  };
}

function sortFeedEntries(entries, sortMode) {
  entries.sort((a, b) => {
    switch (sortMode) {
      case "relevance":
        return b.score - a.score || b.sortTime - a.sortTime;
      case "top":
        return b.item.votes - a.item.votes || b.sortTime - a.sortTime;
      case "journeys":
        return (
          b.item.journeyCount - a.item.journeyCount ||
          b.item.votes - a.item.votes ||
          b.sortTime - a.sortTime
        );
      case "newest":
      default:
        return b.sortTime - a.sortTime;
    }
  });
  return entries;
}

module.exports = {
  parseSearchFilters,
  evaluatePostMatch,
  sortFeedEntries,
};