const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const app = require("./app");
const { connectDatabase, disconnectDatabase } = require("./config/database");
const { getServerConfig } = require("./config/env");

const { host, mongodbUri, port } = getServerConfig();

const server = app.listen(port, host, () => {
  console.log(`DOCA API listening on http://${host}:${port}`);
});

async function connectToMongo() {
  try {
    await connectDatabase(mongodbUri);
    console.log("MongoDB connected");
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
    console.error("The API is running, but database endpoints will return 503.");
  }
}

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

connectToMongo();

module.exports = server;
