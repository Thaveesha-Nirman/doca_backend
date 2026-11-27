const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true },
    alias: { type: String, required: true, unique: true, trim: true },
    avatarId: { type: String, default: "avatar_01" },
    gender: { type: String, default: "Prefer not to say" },
    age: { type: Number, min: 13, max: 120 },
    bio: { type: String, default: "", trim: true, maxlength: 200 },
    followers: { type: [String], default: [] },
    following: { type: [String], default: [] },
    fcmTokens: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);