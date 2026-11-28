const express = require("express");
const Comment = require("../models/Comment");
const Post = require("../models/Post");
const User = require("../models/User");
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");
const { sendNotification } = require("../utils/notify");

const router = express.Router();

const VALID_REACTIONS = ["helpful", "heart", "care"];

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

function formatComment(comment, currentUid = null, replies = []) {
  const helpful = comment.reactions?.helpful || [];
  const heart = comment.reactions?.heart || [];
  const care = comment.reactions?.care || [];

  const upvotedBy = Array.isArray(comment.upvotedBy) ? comment.upvotedBy : [];
  const downvotedBy = Array.isArray(comment.downvotedBy)
    ? comment.downvotedBy
    : [];

  let userVote = null;
  if (currentUid) {
    if (upvotedBy.includes(currentUid)) userVote = "up";
    else if (downvotedBy.includes(currentUid)) userVote = "down";
  }

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
    votes: upvotedBy.length - downvotedBy.length,
    userVote,
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

// 1. GET /api/posts/:postId/comments?sort=newest|oldest|mostUpvoted|leastUpvoted
router.get("/posts/:postId/comments", optionalAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const sort = (req.query.sort || "newest").toString();

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

    nested.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      switch (sort) {
        case "mostUpvoted":
          return b.votes - a.votes || bTime - aTime;
        case "leastUpvoted":
          return a.votes - b.votes || bTime - aTime;
        case "oldest":
          return aTime - bTime;
        case "newest":
        default:
          return bTime - aTime;
      }
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

// 2. POST /api/posts/:postId/comments -> Add comment or reply + notify
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
      return res
        .status(404)
        .json({ message: "Complete your profile before commenting." });
    }
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    let resolvedParentId = null;
    let parentComment = null;
    if (parentCommentId) {
      parentComment = await Comment.findById(parentCommentId);
      if (!parentComment || parentComment.postId.toString() !== postId) {
        return res.status(404).json({ message: "Parent comment not found." });
      }
      resolvedParentId = parentComment.parentCommentId || parentComment._id;
    }

    const cleanBody = body.trim().slice(0, 1000);
    const created = await Comment.create({
      postId: post._id,
      parentCommentId: resolvedParentId,
      authorUid: req.firebaseUid,
      alias: user.alias,
      avatarId: user.avatarId || "avatar_01",
      body: cleanBody,
    });

    const newCount = await Comment.countDocuments({ postId: post._id });
    await Post.findByIdAndUpdate(post._id, {
      $set: { commentsCount: newCount },
    });

    const preview =
      cleanBody.length > 60 ? `${cleanBody.slice(0, 60)}...` : cleanBody;

    if (parentComment) {
      // Notify the author of the comment being replied to
      await sendNotification({
        recipientUid: parentComment.authorUid,
        actorUid: req.firebaseUid,
        actorAlias: user.alias,
        actorAvatarId: user.avatarId || "avatar_01",
        type: "reply",
        title: "New Reply",
        message: `${user.alias} replied to your comment: "${preview}"`,
        referenceId: post._id.toString(),
      });

      // Also notify the post author if they're a different person
      if (post.authorUid !== parentComment.authorUid) {
        await sendNotification({
          recipientUid: post.authorUid,
          actorUid: req.firebaseUid,
          actorAlias: user.alias,
          actorAvatarId: user.avatarId || "avatar_01",
          type: "comment",
          title: "New Comment on Your Post",
          message: `${user.alias} commented on your post: "${preview}"`,
          referenceId: post._id.toString(),
        });
      }
    } else {
      await sendNotification({
        recipientUid: post.authorUid,
        actorUid: req.firebaseUid,
        actorAlias: user.alias,
        actorAvatarId: user.avatarId || "avatar_01",
        type: "comment",
        title: "New Comment",
        message: `${user.alias} commented on your post: "${preview}"`,
        referenceId: post._id.toString(),
      });
    }

    return res.status(201).json({
      comment: formatComment(created, req.firebaseUid, []),
      commentsCount: newCount,
    });
  } catch (err) {
    console.error("Create comment error:", err);
    return res.status(500).json({ message: "Could not post comment" });
  }
});

// 3. PATCH /api/comments/:commentId/vote -> Upvote/downvote + notify on upvote
router.patch(
  "/comments/:commentId/vote",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const { type } = req.body;
      if (!["up", "down"].includes(type)) {
        return res
          .status(400)
          .json({ message: 'Vote type must be "up" or "down"' });
      }

      const comment = await Comment.findById(req.params.commentId);
      if (!comment) {
        return res.status(404).json({ message: "Comment not found." });
      }

      const uid = req.firebaseUid;
      const upList = Array.isArray(comment.upvotedBy) ? comment.upvotedBy : [];
      const downList = Array.isArray(comment.downvotedBy)
        ? comment.downvotedBy
        : [];

      const hasUp = upList.includes(uid);
      const hasDown = downList.includes(uid);

      comment.upvotedBy = upList.filter((id) => id !== uid);
      comment.downvotedBy = downList.filter((id) => id !== uid);

      const newlyUpvoted = type === "up" && !hasUp;
      if (newlyUpvoted) {
        comment.upvotedBy.push(uid);
      } else if (type === "down" && !hasDown) {
        comment.downvotedBy.push(uid);
      }

      await comment.save();

      if (newlyUpvoted) {
        const me = await User.findOne({ firebaseUid: uid });
        if (me) {
          const preview =
            comment.body.length > 50
              ? `${comment.body.slice(0, 50)}...`
              : comment.body;
          await sendNotification({
            recipientUid: comment.authorUid,
            actorUid: uid,
            actorAlias: me.alias,
            actorAvatarId: me.avatarId || "avatar_01",
            type: "comment_upvote",
            title: "Comment Upvoted",
            message: `${me.alias} upvoted your comment: "${preview}"`,
            referenceId: comment.postId.toString(),
          });
        }
      }

      return res.status(200).json({
        comment: formatComment(comment, uid, []),
      });
    } catch (err) {
      console.error("Vote comment error:", err);
      return res.status(500).json({ message: "Could not update vote" });
    }
  }
);

// 4. POST /api/comments/:commentId/react
router.post(
  "/comments/:commentId/react",
  verifyFirebaseToken,
  async (req, res) => {
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
  }
);

// 5. DELETE /api/comments/:commentId
router.delete(
  "/comments/:commentId",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const comment = await Comment.findById(req.params.commentId);
      if (!comment) {
        return res.status(404).json({ message: "Comment not found." });
      }
      if (comment.authorUid !== req.firebaseUid) {
        return res
          .status(403)
          .json({ message: "You can only delete your own comments." });
      }

      const postId = comment.postId;
      await Comment.deleteMany({
        $or: [{ _id: comment._id }, { parentCommentId: comment._id }],
      });

      const newCount = await Comment.countDocuments({ postId });
      await Post.findByIdAndUpdate(postId, {
        $set: { commentsCount: newCount },
      });

      return res.status(200).json({
        message: "Comment deleted",
        commentsCount: newCount,
      });
    } catch (err) {
      console.error("Delete comment error:", err);
      return res.status(500).json({ message: "Could not delete comment" });
    }
  }
);

module.exports = router;