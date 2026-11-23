const mongoose = require("mongoose");

mongoose.set("strictQuery", true);

async function connectDatabase(uri) {
  if (!uri) {
    throw new Error("MONGODB_URI is required in the .env file.");
  }

  return mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connectDatabase, disconnectDatabase };
