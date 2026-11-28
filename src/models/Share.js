const mongoose = require("mongoose");

const shareSchema = new mongoose.Schema(
  {
    sharerUid: { type: String, required: true, index: true },
    sharerAlias: { type: String, required: true, trim: true },
    sharerAvatarId: { type: String, default: "avatar_01" },
    caption: { type: String, default: "", trim: true, maxlength: 500 },
    sharedAt: { type: Date, default: Date.now },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

shareSchema.index({ sharerUid: 1, postId: 1 }, { unique: true });

module.exports = mongoose.model("Share", shareSchema);