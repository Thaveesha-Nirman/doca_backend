const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    senderUid: { type: String, required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 1500 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);