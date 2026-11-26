const express = require("express");
const User = require("../models/User");
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");

const router = express.Router();

function formatUser(user) {
  return {
    id: user._id.toString(),
    firebaseUid: user.firebaseUid,
    alias: user.alias,
    avatarId: user.avatarId,
    gender: user.gender,
    age: user.age,
  };
}

// POST /api/auth/sync -> Checks if this Gmail already has an account in MongoDB
router.post("/auth/sync", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.firebaseUid });
    if (!user) {
      return res.status(200).json({ isNewUser: true, user: null });
    }
    return res.status(200).json({ isNewUser: false, user: formatUser(user) });
  } catch (err) {
    console.error("Sync error:", err);
    return res.status(500).json({ message: "Server error during sync" });
  }
});

// POST /api/auth/onboarding -> Saves new anonymous profile to MongoDB
router.post("/auth/onboarding", verifyFirebaseToken, async (req, res) => {
  try {
    const existing = await User.findOne({ firebaseUid: req.firebaseUid });
    if (existing) {
      return res.status(409).json({
        message: "This email already has an account. Please use Log In.",
      });
    }

    const { alias, avatarId = "avatar_01", gender, age } = req.body;
    if (!alias || !alias.trim()) {
      return res.status(400).json({ message: "Alias is required" });
    }

    const aliasTaken = await User.findOne({ alias: alias.trim() });
    if (aliasTaken) {
      return res.status(409).json({
        message: "That alias is already taken. Try another one!",
      });
    }

    const user = await User.create({
      firebaseUid: req.firebaseUid,
      alias: alias.trim(),
      avatarId,
      gender,
      age: age ? Number(age) : null,
    });

    return res.status(201).json({ user: formatUser(user) });
  } catch (err) {
    console.error("Onboarding error:", err);
    return res.status(500).json({ message: "Could not save profile" });
  }
});

// GET /api/users/me -> Loads the logged-in user's profile for ProfileScreen
router.get("/users/me", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.firebaseUid });
    if (!user) {
      return res.status(404).json({ message: "Profile not found" });
    }
    return res.status(200).json({ user: formatUser(user) });
  } catch (err) {
    console.error("Profile fetch error:", err);
    return res.status(500).json({ message: "Could not load profile" });
  }
});

module.exports = router;