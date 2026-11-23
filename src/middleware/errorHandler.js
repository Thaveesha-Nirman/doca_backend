const ApiError = require("../utils/apiError");

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode || 500;

  if (statusCode === 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    status: "error",
    message: statusCode === 500 ? "Internal server error" : error.message,
  });
}

module.exports = { errorHandler, notFoundHandler };
