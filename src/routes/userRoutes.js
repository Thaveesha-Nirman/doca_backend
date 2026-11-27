const express = require("express");
const User = require("../models/User");
const Post = require("../models/Post");
const Share = require("../models/Share");
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");

const router = express.Router();

function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    req.firebaseUid = null;
    return next();
  }
  const mockRes = {
    status: () => ({
      json: () => {
        req.firebaseUid = null;
        next();
      },
      send: () => {
        req.firebaseUid = null;
        next();
      },
    }),
  };
  return verifyFirebaseToken(req, mockRes, next);
}

function formatProfile(user, currentUid = null) {
  const followers = user.followers || [];
  const following = user.following || [];
  return {
    uid: user.firebaseUid,
    alias: user.alias,
    avatarId: user.avatarId || "avatar_01",
    gender: user.gender || "Prefer not to say",
    age: user.age ?? null,
    bio: user.bio || "",
    followersCount: followers.length,
    followingCount: following.length,
    isFollowing: currentUid ? followers.includes(currentUid) : false,
    isMe: currentUid ? user.firebaseUid === currentUid : false,
    createdAt: user.createdAt,
  };
}

function formatPostSummary(
  post,
  currentUid = null,
  rootCountsMap = {},
  shareDoc = null
) {
  const id = post._id.toString();
  const rootId = post.journeyRootId ? post.journeyRootId.toString() : id;
  const upvotedBy = Array.isArray(post.upvotedBy) ? post.upvotedBy : [];
  const downvotedBy = Array.isArray(post.downvotedBy) ? post.downvotedBy : [];
  const sharedBy = Array.isArray(post.sharedBy) ? post.sharedBy : [];

  let userVote = null;
  if (currentUid) {
    if (upvotedBy.includes(currentUid)) userVote = "up";
    else if (downvotedBy.includes(currentUid)) userVote = "down";
  }

  return {
    id,
    feedItemId: shareDoc ? `share_${shareDoc._id.toString()}` : id,
    authorUid: post.authorUid,
    alias: post.alias,
    avatarId: post.avatarId || "avatar_01",
    title: post.title,
    body: post.body,
    status: post.status,
    images: post.images || [],
    isSensitive: Boolean(post.isSensitive),
    journeyRootId: rootId,
    isJourneyRoot: !post.journeyRootId,
    stepNumber: post.stepNumber || 1,
    journeyCount: rootCountsMap[rootId] || post.journeyCount || 1,
    votes: upvotedBy.length - downvotedBy.length,
    userVote,
    comments: post.commentsCount || 0,
    sharesCount: sharedBy.length,
    isSharedByMe: currentUid ? sharedBy.includes(currentUid) : false,
    isOwner: currentUid ? post.authorUid === currentUid : false,
    sharedBy: shareDoc
      ? {
          id: shareDoc._id.toString(),
          uid: shareDoc.sharerUid,
          alias: shareDoc.sharerAlias,
          avatarId: shareDoc.sharerAvatarId || "avatar_01",
          caption: shareDoc.caption || "",
          isMe: currentUid ? shareDoc.sharerUid === currentUid : false,
          sharedAt: shareDoc.sharedAt || shareDoc.createdAt,
        }
      : null,
    createdAt: post.createdAt,
  };
}

async function buildRootCountsMap(posts) {
  const rootIds = [
    ...new Set(
      posts
        .filter(Boolean)
        .map((p) =>
          p.journeyRootId ? p.journeyRootId.toString() : p._id.toString()
        )
    ),
  ];
  if (rootIds.length === 0) return {};
  const roots = await Post.find({ _id: { $in: rootIds } }).select(
    "_id journeyCount"
  );
  const map = {};
  for (const r of roots) map[r._id.toString()] = r.journeyCount || 1;
  return map;
}

// 1. GET /api/profile/me
router.get("/profile/me", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.firebaseUid });
    if (!user) {
      return res.status(404).json({ message: "Profile not found" });
    }
    return res.status(200).json({ user: formatProfile(user, req.firebaseUid) });
  } catch (err) {
    console.error("Get my profile error:", err);
    return res.status(500).json({ message: "Could not load profile" });
  }
});

// 2. PATCH /api/profile/me
router.patch("/profile/me", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.firebaseUid });
    if (!user) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const { alias, bio, gender, age, avatarId } = req.body;
    let identityChanged = false;

    if (typeof alias === "string" && alias.trim().length >= 3) {
      const cleanAlias = alias.trim();
      if (cleanAlias !== user.alias) {
        const taken = await User.findOne({ alias: cleanAlias });
        if (taken) {
          return res.status(409).json({ message: "That alias is already taken." });
        }
        user.alias = cleanAlias;
        identityChanged = true;
      }
    }

    if (typeof bio === "string") {
      user.bio = bio.trim().slice(0, 200);
    }

    if (typeof gender === "string" && gender.trim().length > 0) {
      user.gender = gender.trim();
    }

    if (age !== undefined && age !== null) {
      const parsedAge = Number(age);
      if (!Number.isNaN(parsedAge) && parsedAge >= 13 && parsedAge <= 120) {
        user.age = parsedAge;
      }
    }

    if (typeof avatarId === "string" && avatarId.trim().length > 0) {
      user.avatarId = avatarId.trim();
      identityChanged = true;
    }

    await user.save();

    if (identityChanged) {
      await Promise.all([
        Post.updateMany(
          { authorUid: req.firebaseUid },
          { $set: { alias: user.alias, avatarId: user.avatarId } }
        ),
        Share.updateMany(
          { sharerUid: req.firebaseUid },
          { $set: { sharerAlias: user.alias, sharerAvatarId: user.avatarId } }
        ),
      ]);
    }

    return res.status(200).json({ user: formatProfile(user, req.firebaseUid) });
  } catch (err) {
    console.error("Update profile error:", err);
    return res.status(500).json({ message: "Could not update profile" });
  }
});

// 3. GET /api/users/:uid
router.get("/users/:uid", optionalAuth, async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const user = await User.findOne({ firebaseUid: targetUid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const [journeys, rawShares, legacyShared] = await Promise.all([
      Post.find({ authorUid: targetUid }).sort({ createdAt: -1 }).limit(30),
      Share.find({ sharerUid: targetUid })
        .sort({ createdAt: -1 })
        .limit(30)
        .populate("postId"),
      Post.find({ sharedBy: targetUid }).sort({ createdAt: -1 }).limit(30),
    ]);

    const validShares = rawShares.filter((s) => s.postId);
    const seenIds = new Set(validShares.map((s) => s.postId._id.toString()));
    const extraLegacy = legacyShared.filter(
      (p) => !seenIds.has(p._id.toString())
    );

    const allPosts = [
      ...journeys,
      ...validShares.map((s) => s.postId),
      ...extraLegacy,
    ];
    const countsMap = await buildRootCountsMap(allPosts);

    const formattedShared = [
      ...validShares.map((s) =>
        formatPostSummary(s.postId, req.firebaseUid, countsMap, s)
      ),
      ...extraLegacy.map((p) =>
        formatPostSummary(p, req.firebaseUid, countsMap, {
          _id: `legacy_${p._id}`,
          sharerUid: targetUid,
          sharerAlias: user.alias,
          sharerAvatarId: user.avatarId || "avatar_01",
          createdAt: p.updatedAt || p.createdAt,
        })
      ),
    ];

    return res.status(200).json({
      user: formatProfile(user, req.firebaseUid),
      journeys: journeys.map((p) =>
        formatPostSummary(p, req.firebaseUid, countsMap)
      ),
      sharedPosts: formattedShared,
    });
  } catch (err) {
    console.error("Get public user profile error:", err);
    return res.status(500).json({ message: "Could not load user profile" });
  }
});

// 4. POST /api/users/:uid/follow
router.post("/users/:uid/follow", verifyFirebaseToken, async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const myUid = req.firebaseUid;

    if (targetUid === myUid) {
      return res.status(400).json({ message: "You cannot follow yourself." });
    }

    const [me, target] = await Promise.all([
      User.findOne({ firebaseUid: myUid }),
      User.findOne({ firebaseUid: targetUid }),
    ]);

    if (!me || !target) {
      return res.status(404).json({ message: "User not found" });
    }

    const alreadyFollowing = (me.following || []).includes(targetUid);

    if (alreadyFollowing) {
      me.following = (me.following || []).filter((id) => id !== targetUid);
      target.followers = (target.followers || []).filter((id) => id !== myUid);
    } else {
      me.following = [...new Set([...(me.following || []), targetUid])];
      target.followers = [...new Set([...(target.followers || []), myUid])];
    }

    await Promise.all([me.save(), target.save()]);

    return res.status(200).json({
      isFollowing: !alreadyFollowing,
      followersCount: target.followers.length,
      followingCount: me.following.length,
    });
  } catch (err) {
    console.error("Follow toggle error:", err);
    return res.status(500).json({ message: "Could not update follow status" });
  }
});

module.exports = router;