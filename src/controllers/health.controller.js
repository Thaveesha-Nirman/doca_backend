const mongoose = require("mongoose");

const databaseStates = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

function getHealth(req, res) {
  const database = databaseStates[mongoose.connection.readyState] || "unknown";
  const healthy = database === "connected";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "DOCA API",
    version: "v1",
    database,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}

module.exports = { getHealth };
