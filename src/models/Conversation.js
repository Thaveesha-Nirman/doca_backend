const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => arr.length === 2,
        message: "A conversation must have exactly 2 participants.",
      },
    },
    participantsKey: { type: String, required: true, unique: true, index: true },
    lastMessageText: { type: String, default: "" },
    lastSenderUid: { type: String, default: null },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", conversationSchema);