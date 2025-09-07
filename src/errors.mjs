/**
 * Centralized error handling framework
 * Provides consistent error handling, logging, and recovery mechanisms
 */

/**
 * Base error class for all application errors
 */
export class AppError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.isOperational = true; // Indicates this is an expected error
  }
}

/**
 * Processing-related errors
 */
export class ProcessingError extends AppError {
  constructor(message, details = {}) {
    super(message, 'PROCESSING_FAILED', details);
    this.name = 'ProcessingError';
  }
}

/**
 * Validation errors for user input
 */
export class ValidationError extends AppError {
  constructor(message, field, value = null) {
    super(message, 'VALIDATION_FAILED', { field, value });
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Configuration-related errors
 */
export class ConfigurationError extends AppError {
  constructor(message, details = {}) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

/**
 * API-related errors
 */
export class ApiError extends AppError {
  constructor(message, service, statusCode = null, details = {}) {
    super(message, 'API_ERROR', { service, statusCode, ...details });
    this.name = 'ApiError';
    this.service = service;
    this.statusCode = statusCode;
  }
}

/**
 * File system operation errors
 */
export class FileSystemError extends AppError {
  constructor(message, operation, filePath, details = {}) {
    super(message, 'FILESYSTEM_ERROR', { operation, filePath, ...details });
    this.name = 'FileSystemError';
    this.operation = operation;
    this.filePath = filePath;
  }
}

/**
 * Error severity levels
 */
export const ErrorSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * Determines error severity based on error type and context
 * @param {Error} error - The error to analyze
 * @param {string} context - Context where error occurred
 * @returns {string} - Severity level
 */
export function getErrorSeverity(error, context = '') {
  // Critical errors that require immediate attention
  if (error instanceof ConfigurationError) {
    return ErrorSeverity.CRITICAL;
  }
  
  if (error.code === 'ENOENT' || error.code === 'EACCES') {
    return ErrorSeverity.HIGH;
  }
  
  if (error instanceof ApiError && error.statusCode >= 500) {
    return ErrorSeverity.HIGH;
  }
  
  if (error instanceof ValidationError) {
    return ErrorSeverity.MEDIUM;
  }
  
  if (error instanceof ProcessingError) {
    return ErrorSeverity.MEDIUM;
  }
  
  // Default to medium for unknown errors
  return ErrorSeverity.MEDIUM;
}

/**
 * Formats error information for logging
 * @param {Error} error - The error to format
 * @param {string} context - Context where error occurred
 * @returns {Object} - Formatted error information
 */
export function formatError(error, context = '') {
  const severity = getErrorSeverity(error, context);
  
  const errorInfo = {
    timestamp: new Date().toISOString(),
    severity,
    context,
    name: error.name,
    message: error.message,
    code: error.code || 'UNKNOWN',
    stack: error.stack
  };
  
  // Add additional details for custom errors
  if (error instanceof AppError) {
    errorInfo.details = error.details;
    errorInfo.isOperational = error.isOperational;
  }
  
  // Add specific fields for different error types
  if (error instanceof ApiError) {
    errorInfo.service = error.service;
    errorInfo.statusCode = error.statusCode;
  }
  
  if (error instanceof FileSystemError) {
    errorInfo.operation = error.operation;
    errorInfo.filePath = error.filePath;
  }
  
  if (error instanceof ValidationError) {
    errorInfo.field = error.field;
  }
  
  return errorInfo;
}

/**
 * Logs error with appropriate level and formatting
 * @param {Error} error - The error to log
 * @param {string} context - Context where error occurred
 * @param {Object} options - Logging options
 */
export function logError(error, context = '', options = {}) {
  const errorInfo = formatError(error, context);
  const { includeStack = true, includeDetails = true } = options;
  
  // Create log message
  let logMessage = `[${errorInfo.severity.toUpperCase()}] ${errorInfo.context}: ${errorInfo.message}`;
  
  if (errorInfo.code && errorInfo.code !== 'UNKNOWN') {
    logMessage += ` (${errorInfo.code})`;
  }
  
  // Log based on severity
  switch (errorInfo.severity) {
    case ErrorSeverity.CRITICAL:
      console.error('🚨', logMessage);
      break;
    case ErrorSeverity.HIGH:
      console.error('❌', logMessage);
      break;
    case ErrorSeverity.MEDIUM:
      console.warn('⚠️ ', logMessage);
      break;
    case ErrorSeverity.LOW:
      console.log('ℹ️ ', logMessage);
      break;
  }
  
  // Include additional details for debugging
  if (includeDetails && errorInfo.details && Object.keys(errorInfo.details).length > 0) {
    console.error('   Details:', JSON.stringify(errorInfo.details, null, 2));
  }
  
  // Include stack trace for high severity errors or when explicitly requested
  if (includeStack && (errorInfo.severity === ErrorSeverity.HIGH || errorInfo.severity === ErrorSeverity.CRITICAL)) {
    console.error('   Stack:', errorInfo.stack);
  }
  
  return errorInfo;
}

/**
 * Handles errors with consistent logging and optional recovery
 * @param {Error} error - The error to handle
 * @param {string} context - Context where error occurred
 * @param {Object} options - Handling options
 * @returns {Object} - Error information
 */
export function handleError(error, context = '', options = {}) {
  const { 
    rethrow = true, 
    logOptions = {},
    onError = null 
  } = options;
  
  // Log the error
  const errorInfo = logError(error, context, logOptions);
  
  // Call custom error handler if provided
  if (onError && typeof onError === 'function') {
    try {
      onError(errorInfo);
    } catch (handlerError) {
      console.error('Error in custom error handler:', handlerError.message);
    }
  }
  
  // Re-throw if requested (default behavior)
  if (rethrow) {
    throw error;
  }
  
  return errorInfo;
}

/**
 * Wraps async functions with error handling
 * @param {Function} fn - Async function to wrap
 * @param {string} context - Context for error reporting
 * @param {Object} options - Error handling options
 * @returns {Function} - Wrapped function
 */
export function withErrorHandling(fn, context, options = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return handleError(error, context, options);
    }
  };
}

/**
 * Creates a safe version of a function that won't throw
 * @param {Function} fn - Function to make safe
 * @param {*} defaultValue - Default value to return on error
 * @param {string} context - Context for error reporting
 * @returns {Function} - Safe function
 */
export function makeSafe(fn, defaultValue = null, context = 'safe function') {
  return (...args) => {
    try {
      const result = fn(...args);
      // Handle promises
      if (result && typeof result.catch === 'function') {
        return result.catch(error => {
          logError(error, context, { rethrow: false });
          return defaultValue;
        });
      }
      return result;
    } catch (error) {
      logError(error, context, { rethrow: false });
      return defaultValue;
    }
  };
}

/**
 * Validates that an error is safe to display to users
 * @param {Error} error - Error to check
 * @returns {boolean} - Whether error is safe to display
 */
export function isSafeToDisplay(error) {
  // Only show operational errors to users
  if (error instanceof AppError && error.isOperational) {
    return true;
  }
  
  // Show validation errors
  if (error instanceof ValidationError) {
    return true;
  }
  
  // Don't show system errors, API keys, file paths, etc.
  return false;
}

/**
 * Gets a user-friendly error message
 * @param {Error} error - The error
 * @returns {string} - User-friendly message
 */
export function getUserFriendlyMessage(error) {
  if (isSafeToDisplay(error)) {
    return error.message;
  }
  
  // Generic messages for different error types
  if (error.code === 'ENOENT') {
    return 'File not found. Please check the file path and try again.';
  }
  
  if (error.code === 'EACCES') {
    return 'Permission denied. Please check file permissions.';
  }
  
  if (error instanceof ApiError) {
    return `Service temporarily unavailable (${error.service}). Please try again later.`;
  }
  
  return 'An unexpected error occurred. Please try again or contact support.';
}
