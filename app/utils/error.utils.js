export class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = options.code || 'APP_ERROR';
    this.details = options.details || null;
  }
}

function createValidationError(details) {
  return new AppError(400, 'Validation failed', {
    code: 'VALIDATION_ERROR',
    details,
  });
}

function formatErrorResponse(error) {
  return {
    success: false,
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.details ? { errors: error.details } : {}),
  };
}

export { createValidationError, formatErrorResponse };
