const express = require("express");
const User = require("../models/User");
const Notification = require("../models/Notification");
const MessageRequest = require("../models/MessageRequest");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const verifyFirebaseToken = require("../middleware/verifyFirebaseToken");
const { sendNotification } = require("../utils/notify");

const router = express.Router();

function makeParticipantsKey(uidA, uidB) {
  return [uidA, uidB].sort().join("::");
}

// 0A. POST /api/inbox/fcm-token -> Save device push token for logged-in user
router.post("/inbox/fcm-token", verifyFirebaseToken, async (req, res) => {
  try {
    const token = (req.body?.token || "").toString().trim();
    if (!token) {
      return res.status(400).json({ message: "FCM token is required." });
    }

    // Ensure this device token isn't attached to another account on the same phone
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

// 1. GET /api/inbox/notifications -> Notification list (with live request status)
router.get("/inbox/notifications", verifyFirebaseToken, async (req, res) => {
  try {
    const notifications = await Notification.find({
      recipientUid: req.firebaseUid,
    })
      .sort({ createdAt: -1 })
      .limit(50);

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
      notifications: formatted,
    });
  } catch (err) {
    console.error("Fetch notifications error:", err);
    return res.status(500).json({ message: "Could not load notifications" });
  }
});

// 2. PATCH /api/inbox/notifications/read -> Mark all notifications as read
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

// 4. POST /api/inbox/message-requests -> Send a message request
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

// 5. POST /api/inbox/message-requests/:requestId/respond -> Accept or Decline
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
          lastMessageText: "Message request accepted. Say hello!",
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

// 6. GET /api/inbox/conversations -> All active chats
router.get("/inbox/conversations", verifyFirebaseToken, async (req, res) => {
  try {
    const myUid = req.firebaseUid;
    const convos = await Conversation.find({ participants: myUid }).sort({
      lastMessageAt: -1,
    });

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
      const otherUid = c.participants.find((uid) => uid !== myUid) || "";
      const other = userMap[otherUid];
      return {
        id: c._id.toString(),
        otherUser: {
          uid: otherUid,
          alias: other ? other.alias : "Anonymous",
          avatarId: other ? other.avatarId || "avatar_01" : "avatar_01",
        },
        lastMessageText: c.lastMessageText || "",
        lastSenderUid: c.lastSenderUid,
        lastMessageAt: c.lastMessageAt,
      };
    });

    return res.status(200).json({ conversations: formatted });
  } catch (err) {
    console.error("Fetch conversations error:", err);
    return res.status(500).json({ message: "Could not load conversations" });
  }
});

// 7. GET /api/inbox/conversations/:conversationId/messages
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

      const messages = await Message.find({ conversationId: convo._id })
        .sort({ createdAt: 1 })
        .limit(100);

      return res.status(200).json({
        messages: messages.map((m) => ({
          id: m._id.toString(),
          conversationId: m.conversationId.toString(),
          senderUid: m.senderUid,
          isMine: m.senderUid === myUid,
          body: m.body,
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      console.error("Fetch messages error:", err);
      return res.status(500).json({ message: "Could not load messages" });
    }
  }
);

// 8. POST /api/inbox/conversations/:conversationId/messages -> Send message + notify
router.post(
  "/inbox/conversations/:conversationId/messages",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const myUid = req.firebaseUid;
      const { body } = req.body;

      if (!body || !body.trim()) {
        return res.status(400).json({ message: "Message cannot be empty." });
      }

      const convo = await Conversation.findById(req.params.conversationId);
      if (!convo) {
        return res.status(404).json({ message: "Conversation not found." });
      }
      if (!convo.participants.includes(myUid)) {
        return res.status(403).json({ message: "Access denied." });
      }

      const cleanText = body.trim().slice(0, 1500);
      const created = await Message.create({
        conversationId: convo._id,
        senderUid: myUid,
        body: cleanText,
      });

      convo.lastMessageText = cleanText;
      convo.lastSenderUid = myUid;
      convo.lastMessageAt = created.createdAt;
      await convo.save();

      // Notify the other person in the chat
      const otherUid = convo.participants.find((uid) => uid !== myUid);
      const me = await User.findOne({ firebaseUid: myUid });
      if (otherUid && me) {
        const preview =
          cleanText.length > 70 ? `${cleanText.slice(0, 70)}...` : cleanText;
        await sendNotification({
          recipientUid: otherUid,
          actorUid: myUid,
          actorAlias: me.alias,
          actorAvatarId: me.avatarId || "avatar_01",
          type: "message",
          title: `New message from ${me.alias}`,
          message: `${me.alias}: ${preview}`,
          referenceId: convo._id.toString(),
        });
      }

      return res.status(201).json({
        message: {
          id: created._id.toString(),
          conversationId: created.conversationId.toString(),
          senderUid: created.senderUid,
          isMine: true,
          body: created.body,
          createdAt: created.createdAt,
        },
      });
    } catch (err) {
      console.error("Send message error:", err);
      return res.status(500).json({ message: "Could not send message" });
    }
  }
);

module.exports = router;