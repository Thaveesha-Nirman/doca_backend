const cors = require("cors");
const express = require("express");

const apiRouter = require("./routes");
const authRoutes = require("./routes/authRoutes");
const postRoutes = require("./routes/postRoutes");
const userRoutes = require("./routes/userRoutes");
const commentRoutes = require("./routes/commentRoutes");
const inboxRoutes = require("./routes/inboxRoutes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/v1", apiRouter);
app.use("/api", authRoutes);
app.use("/api", postRoutes);
app.use("/api", userRoutes);
app.use("/api", commentRoutes);
app.use("/api", inboxRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;