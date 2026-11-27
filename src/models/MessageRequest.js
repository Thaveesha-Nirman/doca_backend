const mongoose = require("mongoose");

const messageRequestSchema = new mongoose.Schema(
  {
    fromUid: { type: String, required: true, index: true },
    toUid: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
    introMessage: { type: String, default: "", trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

messageRequestSchema.index({ fromUid: 1, toUid: 1 }, { unique: true });

module.exports = mongoose.model("MessageRequest", messageRequestSchema);