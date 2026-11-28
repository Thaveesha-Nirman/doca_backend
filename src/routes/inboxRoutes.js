const express = require("express");
const User = require("../models/User");
const Notification = require("../models/Notification");
const MessageRequest = require("../models/MessageRequest");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");
const { sendNotification } = require("../utils/notify");
const { encryptText, decryptText } = require("../utils/chatCrypto");

const router = express.Router();

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB raw limit

function makeParticipantsKey(uidA, uidB) {
  return [uidA, uidB].sort().join("::");
}

function formatMessage(m, currentUid) {
  const deleted = Boolean(m.isDeleted);
  return {
    id: m._id.toString(),
    conversationId: m.conversationId.toString(),
    senderUid: m.senderUid,
    isMine: m.senderUid === currentUid,
    body: deleted ? "" : decryptText(m.body || ""),
    attachment:
      deleted || !m.attachment
        ? null
        : {
            type: m.attachment.type,
            name: decryptText(m.attachment.name || "document"),
            mimeType: m.attachment.mimeType || "application/octet-stream",
            size: m.attachment.size || 0,
            data: decryptText(m.attachment.data || ""),
          },
    isEdited: Boolean(m.isEdited) && !deleted,
    editedAt: deleted ? null : m.editedAt || null,
    isDeleted: deleted,
    deliveredAt: m.deliveredAt || m.seenAt || null,
    seenAt: m.seenAt || null,
    createdAt: m.createdAt,
  };
}

function buildPreviewText(plainBody, plainAttachment) {
  if (plainBody && plainBody.trim().length > 0) {
    return plainBody.trim();
  }
  if (plainAttachment?.type === "image") {
    return "📷 Photo";
  }
  if (plainAttachment?.type === "file") {
    return `📎 ${plainAttachment.name || "Document"}`;
  }
  return "";
}

async function markIncomingDeliveredAndCountUnread(myUid) {
  const myConvos = await Conversation.find({ participants: myUid }).select(
    "_id"
  );
  const convoIds = myConvos.map((c) => c._id);
  if (convoIds.length === 0) return 0;

  await Message.updateMany(
    {
      conversationId: { $in: convoIds },
      senderUid: { $ne: myUid },
      deliveredAt: null,
    },
    { $set: { deliveredAt: new Date() } }
  );

  return Message.countDocuments({
    conversationId: { $in: convoIds },
    senderUid: { $ne: myUid },
    seenAt: null,
    isDeleted: { $ne: true },
  });
}

// 0A. POST /api/inbox/fcm-token -> Save device push token
router.post("/inbox/fcm-token", verifyFirebaseToken, async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim();
    if (!token) {
      return res.status(400).json({ message: "FCM token is required." });
    }

    await User.updateMany(
      { firebaseUid: { $ne: req.firebaseUid }, fcmTokens: token },
      { $pull: { fcmTokens: token } }
    );

    await User.updateOne(
      { firebaseUid: req.firebaseUid },
      { $addToSet: { fcmTokens: token } }
    );

    return res.status(200).json({ message: "FCM token registered" });
  } catch (err) {
    console.error("Save FCM token error:", err);
    return res.status(500).json({ message: "Could not register push token" });
  }
});

// 0B. DELETE /api/inbox/fcm-token -> Remove device push token on logout
router.delete("/inbox/fcm-token", verifyFirebaseToken, async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim();
    if (token) {
      await User.updateOne(
        { firebaseUid: req.firebaseUid },
        { $pull: { fcmTokens: token } }
      );
    }
    return res.status(200).json({ message: "FCM token removed" });
  } catch (err) {
    console.error("Remove FCM token error:", err);
    return res.status(500).json({ message: "Could not remove push token" });
  }
});

// 1. GET /api/inbox/notifications -> Also marks incoming messages delivered & returns unreadMessagesCount
router.get("/inbox/notifications", verifyFirebaseToken, async (req, res) => {
  try {
    const [notifications, unreadMessagesCount] = await Promise.all([
      Notification.find({ recipientUid: req.firebaseUid })
        .sort({ createdAt: -1 })
        .limit(50),
      markIncomingDeliveredAndCountUnread(req.firebaseUid),
    ]);

    const requestIds = notifications
      .filter((n) => n.type === "message_request" && n.referenceId)
      .map((n) => n.referenceId);

    const requestStatusMap = {};
    if (requestIds.length > 0) {
      const requests = await MessageRequest.find({
        _id: { $in: requestIds },
      }).select("_id status");
      for (const r of requests) {
        requestStatusMap[r._id.toString()] = r.status;
      }
    }

    const formatted = notifications.map((n) => ({
      id: n._id.toString(),
      actorUid: n.actorUid,
      actorAlias: n.actorAlias,
      actorAvatarId: n.actorAvatarId || "avatar_01",
      type: n.type,
      referenceId: n.referenceId,
      requestStatus:
        n.type === "message_request" && n.referenceId
          ? requestStatusMap[n.referenceId] || "pending"
          : null,
      message: n.message,
      isRead: Boolean(n.isRead),
      createdAt: n.createdAt,
    }));

    const unreadCount = formatted.filter((n) => !n.isRead).length;

    return res.status(200).json({
      unreadCount,
      unreadMessagesCount,
      notifications: formatted,
    });
  } catch (err) {
    console.error("Fetch notifications error:", err);
    return res.status(500).json({ message: "Could not load notifications" });
  }
});

// 2. PATCH /api/inbox/notifications/read
router.patch(
  "/inbox/notifications/read",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      await Notification.updateMany(
        { recipientUid: req.firebaseUid, isRead: false },
        { $set: { isRead: true } }
      );
      return res.status(200).json({ message: "Notifications marked as read" });
    } catch (err) {
      console.error("Mark notifications read error:", err);
      return res.status(500).json({ message: "Could not update notifications" });
    }
  }
);

// 3. GET /api/inbox/message-requests/status/:targetUid
router.get(
  "/inbox/message-requests/status/:targetUid",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const myUid = req.firebaseUid;
      const targetUid = req.params.targetUid;

      if (myUid === targetUid) {
        return res.status(200).json({ status: "self" });
      }

      const key = makeParticipantsKey(myUid, targetUid);
      const existingConvo = await Conversation.findOne({ participantsKey: key });
      if (existingConvo) {
        return res.status(200).json({
          status: "accepted",
          conversationId: existingConvo._id.toString(),
        });
      }

      const sent = await MessageRequest.findOne({
        fromUid: myUid,
        toUid: targetUid,
        status: "pending",
      });
      if (sent) {
        return res.status(200).json({
          status: "pending_sent",
          requestId: sent._id.toString(),
        });
      }

      const received = await MessageRequest.findOne({
        fromUid: targetUid,
        toUid: myUid,
        status: "pending",
      });
      if (received) {
        return res.status(200).json({
          status: "pending_received",
          requestId: received._id.toString(),
        });
      }

      return res.status(200).json({ status: "none" });
    } catch (err) {
      console.error("Check message request status error:", err);
      return res.status(500).json({ message: "Could not check chat status" });
    }
  }
);

// 4. POST /api/inbox/message-requests
router.post("/inbox/message-requests", verifyFirebaseToken, async (req, res) => {
  try {
    const myUid = req.firebaseUid;
    const { toUid, introMessage = "" } = req.body;

    if (!toUid || toUid === myUid) {
      return res.status(400).json({ message: "Invalid recipient." });
    }

    const [me, target] = await Promise.all([
      User.findOne({ firebaseUid: myUid }),
      User.findOne({ firebaseUid: toUid }),
    ]);

    if (!me || !target) {
      return res.status(404).json({ message: "User not found." });
    }

    const key = makeParticipantsKey(myUid, toUid);
    const existingConvo = await Conversation.findOne({ participantsKey: key });
    if (existingConvo) {
      return res.status(200).json({
        status: "accepted",
        conversationId: existingConvo._id.toString(),
      });
    }

    let request = await MessageRequest.findOne({ fromUid: myUid, toUid });
    if (request && request.status === "pending") {
      return res.status(200).json({
        status: "pending_sent",
        requestId: request._id.toString(),
        message: "Message request already sent.",
      });
    }

    if (request) {
      request.status = "pending";
      request.introMessage = introMessage.trim().slice(0, 300);
      await request.save();
    } else {
      request = await MessageRequest.create({
        fromUid: myUid,
        toUid,
        status: "pending",
        introMessage: introMessage.trim().slice(0, 300),
      });
    }

    await sendNotification({
      recipientUid: toUid,
      actorUid: myUid,
      actorAlias: me.alias,
      actorAvatarId: me.avatarId || "avatar_01",
      type: "message_request",
      title: "New Message Request",
      message: `${me.alias} sent you a message request.`,
      referenceId: request._id.toString(),
    });

    return res.status(201).json({
      status: "pending_sent",
      requestId: request._id.toString(),
      message: "Message request sent!",
    });
  } catch (err) {
    console.error("Send message request error:", err);
    return res.status(500).json({ message: "Could not send message request" });
  }
});

// 5. POST /api/inbox/message-requests/:requestId/respond
router.post(
  "/inbox/message-requests/:requestId/respond",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const myUid = req.firebaseUid;
      const { action } = req.body;

      if (!["accept", "decline"].includes(action)) {
        return res
          .status(400)
          .json({ message: 'Action must be "accept" or "decline".' });
      }

      const request = await MessageRequest.findById(req.params.requestId);
      if (!request) {
        return res.status(404).json({ message: "Message request not found." });
      }
      if (request.toUid !== myUid) {
        return res
          .status(403)
          .json({ message: "Only the recipient can respond to this request." });
      }

      if (action === "decline") {
        request.status = "declined";
        await request.save();
        await Notification.updateMany(
          { referenceId: request._id.toString(), recipientUid: myUid },
          { $set: { isRead: true } }
        );
        return res.status(200).json({ status: "declined" });
      }

      request.status = "accepted";
      await request.save();

      const key = makeParticipantsKey(request.fromUid, request.toUid);
      let convo = await Conversation.findOne({ participantsKey: key });
      if (!convo) {
        convo = await Conversation.create({
          participants: [request.fromUid, request.toUid].sort(),
          participantsKey: key,
          lastMessageText: encryptText("Message request accepted. Say hello!"),
          lastMessageAt: new Date(),
        });
      }

      await Notification.updateMany(
        { referenceId: request._id.toString(), recipientUid: myUid },
        { $set: { isRead: true } }
      );

      const me = await User.findOne({ firebaseUid: myUid });
      if (me) {
        await sendNotification({
          recipientUid: request.fromUid,
          actorUid: myUid,
          actorAlias: me.alias,
          actorAvatarId: me.avatarId || "avatar_01",
          type: "request_accepted",
          title: "Request Accepted",
          message: `${me.alias} accepted your message request. You can now chat!`,
          referenceId: convo._id.toString(),
        });
      }

      return res.status(200).json({
        status: "accepted",
        conversationId: convo._id.toString(),
      });
    } catch (err) {
      console.error("Respond message request error:", err);
      return res.status(500).json({ message: "Could not process request" });
    }
  }
);

// 6. GET /api/inbox/conversations -> Marks incoming delivered + returns per-chat unreadCount
router.get("/inbox/conversations", verifyFirebaseToken, async (req, res) => {
  try {
    const myUid = req.firebaseUid;
    const convos = await Conversation.find({ participants: myUid }).sort({
      lastMessageAt: -1,
    });

    const convoIds = convos.map((c) => c._id);

    // Mark incoming messages as delivered now that recipient synced Inbox
    if (convoIds.length > 0) {
      await Message.updateMany(
        {
          conversationId: { $in: convoIds },
          senderUid: { $ne: myUid },
          deliveredAt: null,
        },
        { $set: { deliveredAt: new Date() } }
      );
    }

    // Count unread messages per conversation
    const unreadAgg =
      convoIds.length > 0
        ? await Message.aggregate([
            {
              $match: {
                conversationId: { $in: convoIds },
                senderUid: { $ne: myUid },
                seenAt: null,
                isDeleted: { $ne: true },
              },
            },
            { $group: { _id: "$conversationId", count: { $sum: 1 } } },
          ])
        : [];

    const unreadMap = {};
    let totalUnreadMessages = 0;
    for (const row of unreadAgg) {
      const cid = row._id.toString();
      unreadMap[cid] = row.count;
      totalUnreadMessages += row.count;
    }

    const otherUids = convos
      .map((c) => c.participants.find((uid) => uid !== myUid))
      .filter(Boolean);

    const otherUsers = await User.find({
      firebaseUid: { $in: otherUids },
    }).select("firebaseUid alias avatarId");
    const userMap = {};
    for (const u of otherUsers) {
      userMap[u.firebaseUid] = u;
    }

    const formatted = convos.map((c) => {
      const cid = c._id.toString();
      const otherUid = c.participants.find((uid) => uid !== myUid) || "";
      const other = userMap[otherUid];
      return {
        id: cid,
        otherUser: {
          uid: otherUid,
          alias: other ? other.alias : "Anonymous",
          avatarId: other ? other.avatarId || "avatar_01" : "avatar_01",
        },
        lastMessageText: decryptText(c.lastMessageText || ""),
        lastSenderUid: c.lastSenderUid,
        lastMessageAt: c.lastMessageAt,
        unreadCount: unreadMap[cid] || 0,
      };
    });

    return res.status(200).json({
      totalUnreadMessages,
      conversations: formatted,
    });
  } catch (err) {
    console.error("Fetch conversations error:", err);
    return res.status(500).json({ message: "Could not load conversations" });
  }
});

// 7. GET /api/inbox/conversations/:conversationId/messages -> Marks Delivered + Seen & decrypts
router.get(
  "/inbox/conversations/:conversationId/messages",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const myUid = req.firebaseUid;
      const convo = await Conversation.findById(req.params.conversationId);
      if (!convo) {
        return res.status(404).json({ message: "Conversation not found." });
      }
      if (!convo.participants.includes(myUid)) {
        return res.status(403).json({ message: "Access denied." });
      }

      const now = new Date();

      // Ensure deliveredAt is set for any undelivered incoming messages
      await Message.updateMany(
        {
          conversationId: convo._id,
          senderUid: { $ne: myUid },
          deliveredAt: null,
        },
        { $set: { deliveredAt: now } }
      );

      // Mark all unseen incoming messages as seen
      await Message.updateMany(
        {
          conversationId: convo._id,
          senderUid: { $ne: myUid },
          seenAt: null,
        },
        { $set: { seenAt: now } }
      );

      const latest = await Message.find({ conversationId: convo._id })
        .sort({ createdAt: -1 })
        .limit(100);
      latest.reverse();

      return res.status(200).json({
        messages: latest.map((m) => formatMessage(m, myUid)),
      });
    } catch (err) {
      console.error("Fetch messages error:", err);
      return res.status(500).json({ message: "Could not load messages" });
    }
  }
);

// 8. POST /api/inbox/conversations/:conversationId/messages -> Encrypts before saving to MongoDB
router.post(
  "/inbox/conversations/:conversationId/messages",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const myUid = req.firebaseUid;
      const cleanText =
        typeof req.body?.body === "string"
          ? req.body.body.trim().slice(0, 1500)
          : "";
      const rawAtt = req.body?.attachment || null;

      let plainAttachment = null;
      let encryptedAttachment = null;

      if (rawAtt && typeof rawAtt === "object") {
        const type = rawAtt.type === "image" ? "image" : "file";
        const name = (
          rawAtt.name || (type === "image" ? "photo.jpg" : "document.pdf")
        )
          .toString()
          .trim()
          .slice(0, 200);
        const mimeType = (
          rawAtt.mimeType ||
          (type === "image" ? "image/jpeg" : "application/pdf")
        )
          .toString()
          .trim();
        const data = (rawAtt.data || "").toString().trim();

        if (!data) {
          return res
            .status(400)
            .json({ message: "Attachment data is empty." });
        }

        const approxBytes = Math.ceil((data.length * 3) / 4);
        if (approxBytes > MAX_ATTACHMENT_BYTES) {
          return res.status(413).json({
            message: "Attachment is too large. Please keep files under 5 MB.",
          });
        }

        plainAttachment = { type, name };
        encryptedAttachment = {
          type,
          name: encryptText(name),
          mimeType,
          size: Number(rawAtt.size) || approxBytes,
          data: encryptText(data),
        };
      }

      if (!cleanText && !encryptedAttachment) {
        return res
          .status(400)
          .json({ message: "Message or attachment is required." });
      }

      const convo = await Conversation.findById(req.params.conversationId);
      if (!convo) {
        return res.status(404).json({ message: "Conversation not found." });
      }
      if (!convo.participants.includes(myUid)) {
        return res.status(403).json({ message: "Access denied." });
      }

      const created = await Message.create({
        conversationId: convo._id,
        senderUid: myUid,
        body: encryptText(cleanText),
        attachment: encryptedAttachment,
      });

      const plainPreview = buildPreviewText(cleanText, plainAttachment);
      convo.lastMessageText = encryptText(plainPreview);
      convo.lastSenderUid = myUid;
      convo.lastMessageAt = created.createdAt;
      await convo.save();

      const otherUid = convo.participants.find((uid) => uid !== myUid);
      const me = await User.findOne({ firebaseUid: myUid });
      if (otherUid && me) {
        const shortPreview =
          plainPreview.length > 70
            ? `${plainPreview.slice(0, 70)}...`
            : plainPreview;
        await sendNotification({
          recipientUid: otherUid,
          actorUid: myUid,
          actorAlias: me.alias,
          actorAvatarId: me.avatarId || "avatar_01",
          type: "message",
          title: `New message from ${me.alias}`,
          message: `${me.alias}: ${shortPreview}`,
          referenceId: convo._id.toString(),
        });
      }

      return res.status(201).json({
        message: formatMessage(created, myUid),
      });
    } catch (err) {
      console.error("Send message error:", err);
      return res.status(500).json({ message: "Could not send message" });
    }
  }
);

// 9. PATCH /api/inbox/messages/:messageId -> Edit (re-encrypts text)
router.patch(
  "/inbox/messages/:messageId",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const myUid = req.firebaseUid;
      const cleanText =
        typeof req.body?.body === "string"
          ? req.body.body.trim().slice(0, 1500)
          : "";

      const msg = await Message.findById(req.params.messageId);
      if (!msg) {
        return res.status(404).json({ message: "Message not found." });
      }
      if (msg.senderUid !== myUid) {
        return res
          .status(403)
          .json({ message: "You can only edit your own messages." });
      }
      if (msg.isDeleted) {
        return res
          .status(400)
          .json({ message: "Deleted messages cannot be edited." });
      }
      if (!cleanText && !msg.attachment) {
        return res.status(400).json({ message: "Message cannot be empty." });
      }

      msg.body = encryptText(cleanText);
      msg.isEdited = true;
      msg.editedAt = new Date();
      await msg.save();

      const latest = await Message.findOne({
        conversationId: msg.conversationId,
      }).sort({ createdAt: -1 });
      if (latest && latest._id.equals(msg._id)) {
        const plainAtt = msg.attachment
          ? {
              type: msg.attachment.type,
              name: decryptText(msg.attachment.name || "Document"),
            }
          : null;
        await Conversation.findByIdAndUpdate(msg.conversationId, {
          $set: {
            lastMessageText: encryptText(buildPreviewText(cleanText, plainAtt)),
          },
        });
      }

      return res.status(200).json({
        message: formatMessage(msg, myUid),
      });
    } catch (err) {
      console.error("Edit message error:", err);
      return res.status(500).json({ message: "Could not edit message" });
    }
  }
);

// 10. DELETE /api/inbox/messages/:messageId -> Soft delete
router.delete(
  "/inbox/messages/:messageId",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const myUid = req.firebaseUid;
      const msg = await Message.findById(req.params.messageId);
      if (!msg) {
        return res.status(404).json({ message: "Message not found." });
      }
      if (msg.senderUid !== myUid) {
        return res
          .status(403)
          .json({ message: "You can only delete your own messages." });
      }

      msg.isDeleted = true;
      msg.body = "";
      msg.attachment = null;
      await msg.save();

      const latest = await Message.findOne({
        conversationId: msg.conversationId,
      }).sort({ createdAt: -1 });
      if (latest && latest._id.equals(msg._id)) {
        await Conversation.findByIdAndUpdate(msg.conversationId, {
          $set: { lastMessageText: encryptText("This message was deleted") },
        });
      }

      return res.status(200).json({
        message: formatMessage(msg, myUid),
      });
    } catch (err) {
      console.error("Delete message error:", err);
      return res.status(500).json({ message: "Could not delete message" });
    }
  }
);

module.exports = router;