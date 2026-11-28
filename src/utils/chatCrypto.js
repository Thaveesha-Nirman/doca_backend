const crypto = require("crypto");

const PREFIX = "enc:v1:";
let cachedKey = null;

function getEncryptionKey() {
  if (cachedKey) return cachedKey;

  const rawSecret = (process.env.CHAT_ENCRYPTION_KEY || "").trim();
  if (!rawSecret) {
    console.warn(
      "[chatCrypto] WARNING: CHAT_ENCRYPTION_KEY is missing in .env. Using fallback dev key."
    );
  }

  const secret = rawSecret || process.env.MONGODB_URI || "doca-local-dev-key";
  // Always derive an exact 32-byte key for AES-256-GCM
  cachedKey = crypto.createHash("sha256").update(secret).digest();
  return cachedKey;
}

function encryptText(plainText) {
  if (plainText === null || plainText === undefined) return "";
  const str = String(plainText);
  if (str.length === 0) return "";
  if (str.startsWith(PREFIX)) return str; // Already encrypted

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(str, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${authTag.toString(
    "base64"
  )}:${encrypted.toString("base64")}`;
}

function decryptText(storedValue) {
  if (storedValue === null || storedValue === undefined) return "";
  const str = String(storedValue);
  if (str.length === 0) return "";

  // Backward compatibility for older plain-text test messages
  if (!str.startsWith(PREFIX)) return str;

  try {
    const payload = str.slice(PREFIX.length);
    const parts = payload.split(":");
    if (parts.length !== 3) return str;

    const iv = Buffer.from(parts[0], "base64");
    const authTag = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      iv
    );
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("[chatCrypto] Decryption failed:", err.message);
    return "[Unable to decrypt message]";
  }
}

module.exports = { encryptText, decryptText };