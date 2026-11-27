const express = require("express");
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
const Comment = require("../models/Comment");
const Post = require("../models/Post");
const User = require("../models/User");
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");

const router = express.Router();

const VALID_REACTIONS = ["helpful", "heart", "care"];

async function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = await admin.auth().verifyIdToken(token);
      req.firebaseUid = decoded.uid;
    } catch (_) {
      req.firebaseUid = null;
    }
  }
  next();
}

function formatComment(comment, currentUid = null, replies = []) {
  const helpful = comment.reactions?.helpful || [];
  const heart = comment.reactions?.heart || [];
  const care = comment.reactions?.care || [];

  const myReactions = [];
  if (currentUid) {
    if (helpful.includes(currentUid)) myReactions.push("helpful");
    if (heart.includes(currentUid)) myReactions.push("heart");
    if (care.includes(currentUid)) myReactions.push("care");
  }

  return {
    id: comment._id.toString(),
    postId: comment.postId.toString(),
    parentCommentId: comment.parentCommentId
      ? comment.parentCommentId.toString()
      : null,
    authorUid: comment.authorUid,
    alias: comment.alias,
    avatarId: comment.avatarId || "avatar_01",
    body: comment.body,
    reactions: {
      helpful: helpful.length,
      heart: heart.length,
      care: care.length,
    },
    totalReactions: helpful.length + heart.length + care.length,
    myReactions,
    isOwner: currentUid ? comment.authorUid === currentUid : false,
    createdAt: comment.createdAt,
    replies,
  };
}

// 1. GET /api/posts/:postId/comments -> Returns top-level comments with nested replies[]
router.get("/posts/:postId/comments", optionalAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const allComments = await Comment.find({ postId }).sort({ createdAt: 1 });

    const topLevel = [];
    const repliesByParent = {};

    for (const c of allComments) {
      if (c.parentCommentId) {
        const parentKey = c.parentCommentId.toString();
        if (!repliesByParent[parentKey]) repliesByParent[parentKey] = [];
        repliesByParent[parentKey].push(formatComment(c, req.firebaseUid, []));
      } else {
        topLevel.push(c);
      }
    }

    const nested = topLevel.map((c) => {
      const id = c._id.toString();
      return formatComment(c, req.firebaseUid, repliesByParent[id] || []);
    });

    return res.status(200).json({
      totalCount: allComments.length,
      comments: nested,
    });
  } catch (err) {
    console.error("Fetch comments error:", err);
    return res.status(500).json({ message: "Could not load comments" });
  }
});

// 2. POST /api/posts/:postId/comments -> Add a comment OR a reply (pass parentCommentId)
router.post("/posts/:postId/comments", verifyFirebaseToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { body, parentCommentId = null } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ message: "Comment cannot be empty." });
    }

    const [user, post] = await Promise.all([
      User.findOne({ firebaseUid: req.firebaseUid }),
      Post.findById(postId),
    ]);

    if (!user) {
      return res.status(404).json({ message: "Complete your profile before commenting." });
    }
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    let resolvedParentId = null;
    if (parentCommentId) {
      const parentComment = await Comment.findById(parentCommentId);
      if (!parentComment || parentComment.postId.toString() !== postId) {
        return res.status(404).json({ message: "Parent comment not found." });
      }
      // Keep replies cleanly 1-level deep on mobile even if replying to a reply
      resolvedParentId = parentComment.parentCommentId || parentComment._id;
    }

    const created = await Comment.create({
      postId: post._id,
      parentCommentId: resolvedParentId,
      authorUid: req.firebaseUid,
      alias: user.alias,
      avatarId: user.avatarId || "avatar_01",
      body: body.trim().slice(0, 1000),
    });

    const newCount = await Comment.countDocuments({ postId: post._id });
    await Post.findByIdAndUpdate(post._id, { $set: { commentsCount: newCount } });

    return res.status(201).json({
      comment: formatComment(created, req.firebaseUid, []),
      commentsCount: newCount,
    });
  } catch (err) {
    console.error("Create comment error:", err);
    return res.status(500).json({ message: "Could not post comment" });
  }
});

// 3. POST /api/comments/:commentId/react -> Toggle reaction ("helpful" | "heart" | "care")
router.post("/comments/:commentId/react", verifyFirebaseToken, async (req, res) => {
  try {
    const { type } = req.body;
    if (!VALID_REACTIONS.includes(type)) {
      return res.status(400).json({
        message: `Reaction type must be one of: ${VALID_REACTIONS.join(", ")}`,
      });
    }

    const comment = await Comment.findById(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: "Comment not found." });
    }

    const uid = req.firebaseUid;
    const currentList = comment.reactions?.[type] || [];
    const alreadyReacted = currentList.includes(uid);

    if (alreadyReacted) {
      comment.reactions[type] = currentList.filter((id) => id !== uid);
    } else {
      comment.reactions[type] = [...currentList, uid];
    }

    comment.markModified("reactions");
    await comment.save();

    return res.status(200).json({
      comment: formatComment(comment, uid, []),
    });
  } catch (err) {
    console.error("React comment error:", err);
    return res.status(500).json({ message: "Could not update reaction" });
  }
});

// 4. DELETE /api/comments/:commentId -> Delete own comment (and its child replies)
router.delete("/comments/:commentId", verifyFirebaseToken, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: "Comment not found." });
    }
    if (comment.authorUid !== req.firebaseUid) {
      return res.status(403).json({ message: "You can only delete your own comments." });
    }

    const postId = comment.postId;
    await Comment.deleteMany({
      $or: [{ _id: comment._id }, { parentCommentId: comment._id }],
    });

    const newCount = await Comment.countDocuments({ postId });
    await Post.findByIdAndUpdate(postId, { $set: { commentsCount: newCount } });

    return res.status(200).json({
      message: "Comment deleted",
      commentsCount: newCount,
    });
  } catch (err) {
    console.error("Delete comment error:", err);
    return res.status(500).json({ message: "Could not delete comment" });
  }
});

module.exports = router;