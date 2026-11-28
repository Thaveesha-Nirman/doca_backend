const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getMessaging } = require("firebase-admin/messaging");
const path = require("path");

if (getApps().length === 0) {
  const serviceAccount = require(path.join(
    __dirname,
    "../../serviceAccountKey.json"
  ));

  initializeApp({
    credential: cert(serviceAccount),
  });
}

const adminAuth = getAuth();
const adminMessaging = getMessaging();

module.exports = { adminAuth, adminMessaging };