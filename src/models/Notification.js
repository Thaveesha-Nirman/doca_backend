const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipientUid: { type: String, required: true, index: true },
    actorUid: { type: String, required: true },
    actorAlias: { type: String, required: true, trim: true },
    actorAvatarId: { type: String, default: "avatar_01" },
    type: {
      type: String,
      enum: ["message_request", "request_accepted", "follow", "comment", "reply"],
      required: true,
    },
    referenceId: { type: String, default: null }, // requestId, conversationId, or postId
    message: { type: String, required: true, trim: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);