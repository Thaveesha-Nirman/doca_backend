const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    parentCommentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },
    authorUid: { type: String, required: true, index: true },
    alias: { type: String, required: true, trim: true },
    avatarId: { type: String, default: "avatar_01" },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    upvotedBy: { type: [String], default: [] },
    downvotedBy: { type: [String], default: [] },
    reactions: {
      helpful: { type: [String], default: [] },
      heart: { type: [String], default: [] },
      care: { type: [String], default: [] },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Comment", commentSchema);