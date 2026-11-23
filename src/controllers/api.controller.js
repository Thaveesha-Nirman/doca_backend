function getApiInfo(req, res) {
  res.json({
    service: "DOCA API",
    version: "v1",
    endpoints: {
      health: "/api/v1/health",
      conditions: "/api/v1/conditions",
      conditionDetails: "/api/v1/conditions/:slug",
      conditionSearch: "/api/v1/conditions/search?q=itchy+rash",
    },
  });
}

module.exports = { getApiInfo };
