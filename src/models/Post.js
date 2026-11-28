const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    authorUid: { type: String, required: true, index: true },
    alias: { type: String, required: true, trim: true },
    avatarId: { type: String, default: "avatar_01" },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 1500 },
    status: {
      type: String,
      enum: ["Asking", "Ongoing", "Healed"],
      default: "Asking",
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 3,
        message: "You can attach up to 3 photos per post.",
      },
    },
    isSensitive: { type: Boolean, default: false },

    // Linked Journey fields
    journeyRootId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
      index: true,
    },
    stepNumber: { type: Number, default: 1 },
    journeyCount: { type: Number, default: 1 },

    // Interactions
    upvotedBy: { type: [String], default: [] },
    downvotedBy: { type: [String], default: [] },
    sharedBy: { type: [String], default: [] },
    commentsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", postSchema);