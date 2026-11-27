const User = require("../models/User");
const Notification = require("../models/Notification");
const { adminMessaging } = require("../config/firebaseAdmin");

/**
 * Saves an in-app notification in MongoDB AND sends a real FCM push
 * to the recipient's Android/iOS notification tray.
 * Automatically skips self-notifications and cleans up expired tokens.
 */
async function sendNotification({
  recipientUid,
  actorUid,
  actorAlias,
  actorAvatarId = "avatar_01",
  type,
  title,
  message,
  referenceId = null,
}) {
  try {
    if (!recipientUid || !actorUid || recipientUid === actorUid) {
      return;
    }

    const safeRefId = referenceId ? String(referenceId) : null;

    // 1. Save to MongoDB (in-app Notifications tab)
    await Notification.create({
      recipientUid,
      actorUid,
      actorAlias,
      actorAvatarId,
      type,
      referenceId: safeRefId,
      message,
    });

    // 2. Send FCM push notification to recipient's phone tray
    const recipient = await User.findOne({ firebaseUid: recipientUid }).select(
      "fcmTokens"
    );
    const tokens = Array.isArray(recipient?.fcmTokens)
      ? recipient.fcmTokens.filter(Boolean)
      : [];

    if (tokens.length === 0) return;

    const response = await adminMessaging.sendEachForMulticast({
      tokens,
      notification: {
        title: title || "Doca",
        body: message,
      },
      data: {
        type: String(type),
        referenceId: safeRefId || "",
        actorUid: String(actorUid),
        actorAlias: String(actorAlias),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "doca_high_importance",
          sound: "default",
        },
      },
    });

    // Remove dead/uninstalled device tokens automatically
    const deadTokens = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const code = res.error?.code || "";
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          deadTokens.push(tokens[idx]);
        }
      }
    });

    if (deadTokens.length > 0) {
      await User.updateOne(
        { firebaseUid: recipientUid },
        { $pull: { fcmTokens: {$in: deadTokens } } }
      );
    }
  } catch (err) {
    console.error("Notification dispatch error:", err.message || err);
  }
}

module.exports = { sendNotification };