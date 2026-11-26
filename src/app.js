const cors = require("cors");
const express = require("express");

const apiRouter = require("./routes");
const authRoutes = require("./routes/authRoutes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.use("/api/v1", apiRouter);
app.use("/api", authRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;