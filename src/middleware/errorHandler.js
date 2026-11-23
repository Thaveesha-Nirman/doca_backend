const ApiError = require("../utils/apiError");

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const suppliedStatus = error.statusCode || error.status;
  const statusCode =
    Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599
      ? suppliedStatus
      : 500;
  const message =
    error.type === "entity.parse.failed"
      ? "Request body contains invalid JSON."
      : statusCode === 500
        ? "Internal server error"
        : error.message;

  if (statusCode === 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    status: "error",
    message,
  });
}

module.exports = { errorHandler, notFoundHandler };
