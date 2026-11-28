const mongoose = require("mongoose");

const conditionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    summary: { type: String, required: true, trim: true },
    synonyms: [{ type: String, trim: true }],
    symptoms: [{ type: String, trim: true }],
    commonLocations: [{ type: String, trim: true }],
    selfCare: [{ type: String, trim: true }],
    seekMedicalCare: [{ type: String, trim: true }],
  },
  {
    timestamps: true,
    versionKey: false,
    bufferCommands: false,
  },
);

conditionSchema.index(
  { name: "text", summary: "text", synonyms: "text", symptoms: "text", commonLocations: "text" },
  {
    name: "condition_search",
    weights: { name: 10, synonyms: 8, symptoms: 6, commonLocations: 3, summary: 2 },
  },
);

module.exports = mongoose.model("Condition", conditionSchema);
