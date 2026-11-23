function parsePort(value) {
  const port = Number(value ?? 5000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

function parseHost(value) {
  const host = String(value || "0.0.0.0").trim();

  if (!host) {
    throw new Error("HOST cannot be empty.");
  }

  return host;
}

function getServerConfig(env = process.env) {
  return {
    port: parsePort(env.PORT),
    host: parseHost(env.HOST),
    mongodbUri: env.MONGODB_URI,
  };
}

module.exports = { getServerConfig, parseHost, parsePort };
