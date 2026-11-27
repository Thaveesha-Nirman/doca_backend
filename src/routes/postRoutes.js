const express = require("express");
const Post = require("../models/Post");
const Share = require("../models/Share");
const User = require("../models/User");
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");
const { sendNotification } = require("../utils/notify");
const {
  parseSearchFilters,
  evaluatePostMatch,
  sortFeedEntries,
} = require("../utils/symptomSearch");

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

function formatPost(
  post,
  currentUid = null,
  rootCountsMap = {},
  shareDoc = null,
  matchInfo = null
) {
  const id = post._id.toString();
  const rootId = post.journeyRootId ? post.journeyRootId.toString() : id;
  const totalSteps = rootCountsMap[rootId] || post.journeyCount || 1;

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
    journeyCount: totalSteps,
    votes: upvotedBy.length - downvotedBy.length,
    userVote,
    comments: post.commentsCount || 0,
    sharesCount: sharedBy.length,
    isSharedByMe: currentUid ? sharedBy.includes(currentUid) : false,
    isOwner: currentUid ? post.authorUid === currentUid : false,
    matchScore: matchInfo ? matchInfo.score : 0,
    matchedTerms: matchInfo ? matchInfo.matchedTerms : [],
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
    updatedAt: post.updatedAt,
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
  for (const r of roots) {
    map[r._id.toString()] = r.journeyCount || 1;
  }
  return map;
}

async function buildFilteredFeed({
  postQuery = {},
  shareQuery = {},
  filters,
  currentUid,
}) {
  const fetchLimit = filters.hasAnyFilter ? 200 : 50;

  const [originalPosts, rawShares] = await Promise.all([
    Post.find(postQuery).sort({ createdAt: -1 }).limit(fetchLimit),
    // When actively searching/filtering symptoms, return clean unique posts without duplicate share cards
    filters.hasAnyFilter
      ? Promise.resolve([])
      : Share.find(shareQuery)
          .sort({ sharedAt: -1, createdAt: -1 })
          .limit(50)
          .populate("postId"),
  ]);

  const validShares = rawShares.filter((s) => s.postId);
  const allUnderlyingPosts = [
    ...originalPosts,
    ...validShares.map((s) => s.postId),
  ];
  const countsMap = await buildRootCountsMap(allUnderlyingPosts);

  const feedEntries = [];

  for (const p of originalPosts) {
    const rootId = p.journeyRootId ? p.journeyRootId.toString() : p._id.toString();
    const totalSteps = countsMap[rootId] || p.journeyCount || 1;
    const matchInfo = evaluatePostMatch(p, totalSteps, filters);
    if (!matchInfo) continue;

    feedEntries.push({
      score: matchInfo.score,
      sortTime: new Date(p.createdAt).getTime(),
      item: formatPost(p, currentUid, countsMap, null, matchInfo),
    });
  }

  for (const s of validShares) {
    const p = s.postId;
    const rootId = p.journeyRootId ? p.journeyRootId.toString() : p._id.toString();
    const totalSteps = countsMap[rootId] || p.journeyCount || 1;
    const matchInfo = evaluatePostMatch(p, totalSteps, filters, s.caption);
    if (!matchInfo) continue;

    feedEntries.push({
      score: matchInfo.score,
      sortTime: new Date(s.sharedAt || s.createdAt).getTime(),
      item: formatPost(p, currentUid, countsMap, s, matchInfo),
    });
  }

  sortFeedEntries(feedEntries, filters.sort);
  return feedEntries.slice(0, 50).map((entry) => entry.item);
}

// 1. GET /api/posts?q=&status=&symptoms=&bodyArea=&hasPhotos=&onlyJourneys=&sort=
router.get("/posts", optionalAuth, async (req, res) => {
  try {
    const filters = parseSearchFilters(req.query);
    const posts = await buildFilteredFeed({
      postQuery: {},
      shareQuery: {},
      filters,
      currentUid: req.firebaseUid,
    });

    return res.status(200).json({ posts });
  } catch (err) {
    console.error("Fetch posts error:", err);
    return res.status(500).json({ message: "Could not load community feed" });
  }
});

// 1B. GET /api/posts/following -> Strict auth + full symptom search & filters
router.get("/posts/following", verifyFirebaseToken, async (req, res) => {
  try {
    const me = await User.findOne({ firebaseUid: req.firebaseUid });
    const followingList =
      me && Array.isArray(me.following) ? me.following : [];

    if (followingList.length === 0) {
      return res.status(200).json({ posts: [] });
    }

    const filters = parseSearchFilters(req.query);
    const posts = await buildFilteredFeed({
      postQuery: { authorUid: { $in: followingList } },
      shareQuery: { sharerUid: { $in: followingList } },
      filters,
      currentUid: req.firebaseUid,
    });

    return res.status(200).json({ posts });
  } catch (err) {
    console.error("Fetch following feed error:", err);
    return res.status(500).json({ message: "Could not load following feed" });
  }
});

// 2. GET /api/posts/mine
router.get("/posts/mine", verifyFirebaseToken, async (req, res) => {
  try {
    const onlyRoots = req.query.onlyRoots === "true";
    const filter = { authorUid: req.firebaseUid };
    if (onlyRoots) filter.journeyRootId = null;

    const posts = await Post.find(filter).sort({ createdAt: -1 });
    const countsMap = await buildRootCountsMap(posts);

    return res.status(200).json({
      posts: posts.map((p) => formatPost(p, req.firebaseUid, countsMap)),
    });
  } catch (err) {
    console.error("Fetch my journeys error:", err);
    return res.status(500).json({ message: "Could not load your journeys" });
  }
});

// 3. GET /api/posts/shared
router.get("/posts/shared", verifyFirebaseToken, async (req, res) => {
  try {
    const [me, shares] = await Promise.all([
      User.findOne({ firebaseUid: req.firebaseUid }),
      Share.find({ sharerUid: req.firebaseUid })
        .sort({ sharedAt: -1, createdAt: -1 })
        .populate("postId"),
    ]);

    const validShares = shares.filter((s) => s.postId);
    const sharedPostIds = new Set(
      validShares.map((s) => s.postId._id.toString())
    );

    const legacyPosts = await Post.find({ sharedBy: req.firebaseUid }).sort({
      createdAt: -1,
    });
    const extraLegacy = legacyPosts.filter(
      (p) => !sharedPostIds.has(p._id.toString())
    );

    const allPosts = [...validShares.map((s) => s.postId), ...extraLegacy];
    const countsMap = await buildRootCountsMap(allPosts);

    const formatted = [
      ...validShares.map((s) =>
        formatPost(s.postId, req.firebaseUid, countsMap, s)
      ),
      ...extraLegacy.map((p) =>
        formatPost(p, req.firebaseUid, countsMap, {
          _id: `legacy_${p._id}`,
          sharerUid: req.firebaseUid,
          sharerAlias: me ? me.alias : "You",
          sharerAvatarId: me ? me.avatarId || "avatar_01" : "avatar_01",
          caption: "",
          sharedAt: p.updatedAt || p.createdAt,
        })
      ),
    ];

    return res.status(200).json({ posts: formatted });
  } catch (err) {
    console.error("Fetch shared posts error:", err);
    return res.status(500).json({ message: "Could not load shared posts" });
  }
});

// 4. GET /api/posts/:id/journey
router.get("/posts/:id/journey", optionalAuth, async (req, res) => {
  try {
    const target = await Post.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ message: "Post not found" });
    }

    const rootId = target.journeyRootId || target._id;
    const timeline = await Post.find({
      $or: [{ _id: rootId }, { journeyRootId: rootId }],
    }).sort({ createdAt: 1 });

    const countsMap = { [rootId.toString()]: timeline.length };

    return res.status(200).json({
      journeyRootId: rootId.toString(),
      totalSteps: timeline.length,
      posts: timeline.map((p) => formatPost(p, req.firebaseUid, countsMap)),
    });
  } catch (err) {
    console.error("Fetch journey timeline error:", err);
    return res.status(500).json({ message: "Could not load journey timeline" });
  }
});

// 5. POST /api/posts
router.post("/posts", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.firebaseUid });
    if (!user) {
      return res.status(404).json({
        message: "Please complete your anonymous profile before posting.",
      });
    }

    const {
      title,
      body,
      status = "Asking",
      images = [],
      isSensitive = false,
      parentPostId = null,
    } = req.body;

    if (!title || title.trim().length < 5) {
      return res
        .status(400)
        .json({ message: "Title must be at least 5 characters." });
    }
    if (!body || body.trim().length < 10) {
      return res
        .status(400)
        .json({ message: "Description must be at least 10 characters." });
    }

    let journeyRootId = null;
    let stepNumber = 1;

    if (parentPostId) {
      const parentPost = await Post.findById(parentPostId);
      if (!parentPost) {
        return res
          .status(404)
          .json({ message: "Original journey post not found." });
      }
      if (parentPost.authorUid !== req.firebaseUid) {
        return res.status(403).json({
          message: "You can only add journey updates to your own posts.",
        });
      }

      const rootId = parentPost.journeyRootId || parentPost._id;
      const existingCount = await Post.countDocuments({
        $or: [{ _id: rootId }, { journeyRootId: rootId }],
      });

      journeyRootId = rootId;
      stepNumber = existingCount + 1;

      await Post.findByIdAndUpdate(rootId, {
        $set: { journeyCount: stepNumber },
      });
    }

    const safeImages = Array.isArray(images) ? images.slice(0, 3) : [];

    const post = await Post.create({
      authorUid: req.firebaseUid,
      alias: user.alias,
      avatarId: user.avatarId || "avatar_01",
      title: title.trim(),
      body: body.trim(),
      status,
      images: safeImages,
      isSensitive: Boolean(isSensitive),
      journeyRootId,
      stepNumber,
      journeyCount: 1,
    });

    const countsMap = {
      [(journeyRootId || post._id).toString()]: stepNumber,
    };

    return res.status(201).json({
      post: formatPost(post, req.firebaseUid, countsMap),
    });
  } catch (err) {
    console.error("Create post error:", err);
    return res.status(500).json({ message: "Could not publish post" });
  }
});

// 6. PATCH /api/posts/:id
router.patch("/posts/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    if (post.authorUid !== req.firebaseUid) {
      return res
        .status(403)
        .json({ message: "You can only edit your own posts" });
    }

    const { title, body, status, images, isSensitive } = req.body;
    if (typeof title === "string" && title.trim().length >= 5) {
      post.title = title.trim();
    }
    if (typeof body === "string" && body.trim().length >= 10) {
      post.body = body.trim();
    }
    if (["Asking", "Ongoing", "Healed"].includes(status)) {
      post.status = status;
    }
    if (Array.isArray(images)) {
      post.images = images.slice(0, 3);
    }
    if (typeof isSensitive === "boolean") {
      post.isSensitive = isSensitive;
    }

    await post.save();
    const countsMap = await buildRootCountsMap([post]);

    return res.status(200).json({
      post: formatPost(post, req.firebaseUid, countsMap),
    });
  } catch (err) {
    console.error("Edit post error:", err);
    return res.status(500).json({ message: "Could not update post" });
  }
});

// 7. DELETE /api/posts/:id
router.delete("/posts/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    if (post.authorUid !== req.firebaseUid) {
      return res
        .status(403)
        .json({ message: "You can only delete your own posts" });
    }

    const rootId = post.journeyRootId;
    await Promise.all([
      Post.findByIdAndDelete(post._id),
      Share.deleteMany({ postId: post._id }),
    ]);

    if (rootId) {
      const remaining = await Post.countDocuments({
        $or: [{ _id: rootId }, { journeyRootId: rootId }],
      });
      await Post.findByIdAndUpdate(rootId, {
        $set: { journeyCount: remaining },
      });
    }

    return res.status(200).json({ message: "Post deleted" });
  } catch (err) {
    console.error("Delete post error:", err);
    return res.status(500).json({ message: "Could not delete post" });
  }
});

// 8. PATCH /api/posts/:id/vote
router.patch("/posts/:id/vote", verifyFirebaseToken, async (req, res) => {
  try {
    const { type } = req.body;
    if (!["up", "down"].includes(type)) {
      return res
        .status(400)
        .json({ message: 'Vote type must be "up" or "down"' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const uid = req.firebaseUid;
    const upList = Array.isArray(post.upvotedBy) ? post.upvotedBy : [];
    const downList = Array.isArray(post.downvotedBy) ? post.downvotedBy : [];

    const hasUp = upList.includes(uid);
    const hasDown = downList.includes(uid);

    post.upvotedBy = upList.filter((id) => id !== uid);
    post.downvotedBy = downList.filter((id) => id !== uid);

    const newlyUpvoted = type === "up" && !hasUp;
    if (newlyUpvoted) {
      post.upvotedBy.push(uid);
    } else if (type === "down" && !hasDown) {
      post.downvotedBy.push(uid);
    }

    await post.save();

    if (newlyUpvoted) {
      const me = await User.findOne({ firebaseUid: uid });
      if (me) {
        const shortTitle =
          post.title.length > 45 ? `${post.title.slice(0, 45)}...` : post.title;
        await sendNotification({
          recipientUid: post.authorUid,
          actorUid: uid,
          actorAlias: me.alias,
          actorAvatarId: me.avatarId || "avatar_01",
          type: "post_upvote",
          title: "New Upvote",
          message: `${me.alias} upvoted your post "${shortTitle}"`,
          referenceId: post._id.toString(),
        });
      }
    }

    const countsMap = await buildRootCountsMap([post]);

    return res.status(200).json({
      post: formatPost(post, uid, countsMap),
    });
  } catch (err) {
    console.error("Vote post error:", err);
    return res.status(500).json({ message: "Could not update vote" });
  }
});

// 9. POST /api/posts/:id/share
router.post("/posts/:id/share", verifyFirebaseToken, async (req, res) => {
  try {
    const [post, user] = await Promise.all([
      Post.findById(req.params.id),
      User.findOne({ firebaseUid: req.firebaseUid }),
    ]);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    if (!user) {
      return res.status(404).json({ message: "Complete your profile first." });
    }

    const uid = req.firebaseUid;
    const cleanCaption =
      typeof req.body?.caption === "string"
        ? req.body.caption.trim().slice(0, 500)
        : "";

    const shareList = Array.isArray(post.sharedBy) ? post.sharedBy : [];
    const alreadyShared = shareList.includes(uid);
    if (!alreadyShared) {
      post.sharedBy = [...shareList, uid];
      await post.save();
    }

    const activeShareDoc = await Share.findOneAndUpdate(
      { sharerUid: uid, postId: post._id },
      {
        $set: {
          sharerAlias: user.alias,
          sharerAvatarId: user.avatarId || "avatar_01",
          caption: cleanCaption,
          sharedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    if (!alreadyShared) {
      const shortTitle =
        post.title.length > 45 ? `${post.title.slice(0, 45)}...` : post.title;
      await sendNotification({
        recipientUid: post.authorUid,
        actorUid: uid,
        actorAlias: user.alias,
        actorAvatarId: user.avatarId || "avatar_01",
        type: "post_share",
        title: "Post Shared",
        message: `${user.alias} shared your post "${shortTitle}"`,
        referenceId: post._id.toString(),
      });
    }

    const countsMap = await buildRootCountsMap([post]);

    return res.status(200).json({
      shared: true,
      post: formatPost(post, uid, countsMap, activeShareDoc),
    });
  } catch (err) {
    console.error("Share post error:", err);
    return res.status(500).json({ message: "Could not share post" });
  }
});

// 9B. DELETE /api/posts/:id/share
router.delete("/posts/:id/share", verifyFirebaseToken, async (req, res) => {
  try {
    const postId = req.params.id;
    const uid = req.firebaseUid;

    await Promise.all([
      Share.deleteMany({ sharerUid: uid, postId }),
      Post.findByIdAndUpdate(postId, { $pull: { sharedBy: uid } }),
    ]);

    return res.status(200).json({
      shared: false,
      message: "Shared post removed",
    });
  } catch (err) {
    console.error("Unshare post error:", err);
    return res.status(500).json({ message: "Could not remove shared post" });
  }
});

// 10. PATCH /api/shares/:shareId
router.patch("/shares/:shareId", verifyFirebaseToken, async (req, res) => {
  try {
    const { shareId } = req.params;
    const uid = req.firebaseUid;
    const cleanCaption =
      typeof req.body?.caption === "string"
        ? req.body.caption.trim().slice(0, 500)
        : "";

    if (shareId.startsWith("legacy_")) {
      const postId = shareId.replace("legacy_", "");
      const [post, user] = await Promise.all([
        Post.findById(postId),
        User.findOne({ firebaseUid: uid }),
      ]);
      if (!post || !user) {
        return res.status(404).json({ message: "Shared post not found" });
      }
      const upgraded = await Share.findOneAndUpdate(
        { sharerUid: uid, postId: post._id },
        {
          $set: {
            sharerAlias: user.alias,
            sharerAvatarId: user.avatarId || "avatar_01",
            caption: cleanCaption,
            sharedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );
      const countsMap = await buildRootCountsMap([post]);
      return res.status(200).json({
        post: formatPost(post, uid, countsMap, upgraded),
      });
    }

    const share = await Share.findById(shareId).populate("postId");
    if (!share || !share.postId) {
      return res.status(404).json({ message: "Shared post not found" });
    }
    if (share.sharerUid !== uid) {
      return res
        .status(403)
        .json({ message: "You can only edit your own shared posts" });
    }

    share.caption = cleanCaption;
    await share.save();

    const countsMap = await buildRootCountsMap([share.postId]);
    return res.status(200).json({
      post: formatPost(share.postId, uid, countsMap, share),
    });
  } catch (err) {
    console.error("Edit share caption error:", err);
    return res.status(500).json({ message: "Could not update caption" });
  }
});

// 11. DELETE /api/shares/:shareId
router.delete("/shares/:shareId", verifyFirebaseToken, async (req, res) => {
  try {
    const { shareId } = req.params;
    const uid = req.firebaseUid;

    if (shareId.startsWith("legacy_")) {
      const postId = shareId.replace("legacy_", "");
      await Post.findByIdAndUpdate(postId, { $pull: { sharedBy: uid } });
      await Share.deleteMany({ sharerUid: uid, postId });
      return res.status(200).json({ message: "Shared post deleted" });
    }

    const share = await Share.findById(shareId);
    if (!share) {
      return res.status(404).json({ message: "Shared post not found" });
    }
    if (share.sharerUid !== uid) {
      return res
        .status(403)
        .json({ message: "You can only delete your own shared posts" });
    }

    const postId = share.postId;
    await Share.findByIdAndDelete(share._id);
    await Post.findByIdAndUpdate(postId, { $pull: { sharedBy: uid } });

    return res.status(200).json({ message: "Shared post deleted" });
  } catch (err) {
    console.error("Delete share error:", err);
    return res.status(500).json({ message: "Could not delete shared post" });
  }
});

module.exports = router;