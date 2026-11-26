const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true },
    alias: { type: String, required: true, trim: true, unique: true },
    avatarId: { type: String, default: "avatar_01" },
    gender: {
      type: String,
      enum: ["Male", "Female", "Prefer not to say"],
      default: "Prefer not to say",
    },
    age: { type: Number, min: 13, max: 120, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);