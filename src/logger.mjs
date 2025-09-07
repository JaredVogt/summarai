/**
 * Centralized logging utility for consistent console output
 * Provides standardized formatting, timestamps, and categorization
 */

import { loadConfig, getConfigValue } from '../configLoader.mjs';

// Log levels in order of severity
export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info', 
  WARN: 'warn',
  ERROR: 'error'
};

// Message categories for consistent prefixes
export const LogCategory = {
  SYSTEM: 'System',
  CONFIG: 'Config', 
  QUEUE: 'Queue',
  PROCESSING: 'Processing',
  API: 'API',
  FILE: 'File',
  MODEL: 'Model',
  VALIDATION: 'Validation',
  WATCH: 'Watch'
};

// Status indicators
export const LogStatus = {
  SUCCESS: '✓',
  ERROR: '❌', 
  WARNING: '⚠️',
  INFO: 'ℹ️',
  PROCESSING: '⏳',
  ARROW: '→',
  BULLET: '•'
};

class Logger {
  constructor() {
    this.config = null;
    this.loadConfiguration();
  }

  loadConfiguration() {
    try {
      this.config = loadConfig();
    } catch (error) {
      // Fallback configuration if config loading fails
      this.config = {
        logging: {
          level: 'info',
          console: {
            verbose: false,
            showTimestamp: true,
            showCategory: true
          }
        }
      };
    }
  }

  /**
   * Get current log level from config
   */
  getLogLevel() {
    return getConfigValue(this.config, 'logging.level', 'info');
  }

  /**
   * Check if verbose mode is enabled
   */
  isVerbose() {
    return getConfigValue(this.config, 'logging.console.verbose', false);
  }

  /**
   * Check if timestamps should be shown
   */
  shouldShowTimestamp() {
    return getConfigValue(this.config, 'logging.console.showTimestamp', true);
  }

  /**
   * Check if category should be shown
   */
  shouldShowCategory() {
    return getConfigValue(this.config, 'logging.console.showCategory', true);
  }

  /**
   * Check if a message should be logged based on current log level
   */
  shouldLog(level) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevel = this.getLogLevel();
    const currentIndex = levels.indexOf(currentLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  /**
   * Format timestamp for display
   */
  formatTimestamp() {
    if (!this.shouldShowTimestamp()) return '';
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { 
      hour12: true, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    return `[${time}] `;
  }

  /**
   * Format category prefix
   */
  formatCategory(category) {
    if (!this.shouldShowCategory() || !category) return '';
    return `[${category}] `;
  }

  /**
   * Format a complete log message
   */
  formatMessage(level, category, message, status = null) {
    const timestamp = this.formatTimestamp();
    const categoryPrefix = this.formatCategory(category);
    const statusIcon = status ? `${status} ` : '';
    
    return `${timestamp}${categoryPrefix}${statusIcon}${message}`;
  }

  /**
   * Core logging method
   */
  log(level, category, message, status = null, ...args) {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, category, message, status);
    
    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage, ...args);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, ...args);
        break;
      case LogLevel.DEBUG:
        if (this.isVerbose()) {
          console.log(formattedMessage, ...args);
        }
        break;
      default:
        console.log(formattedMessage, ...args);
    }
  }

  // Convenience methods for different log levels
  debug(category, message, status = null, ...args) {
    this.log(LogLevel.DEBUG, category, message, status, ...args);
  }

  info(category, message, status = null, ...args) {
    this.log(LogLevel.INFO, category, message, status, ...args);
  }

  warn(category, message, status = null, ...args) {
    this.log(LogLevel.WARN, category, message, status, ...args);
  }

  error(category, message, status = null, ...args) {
    this.log(LogLevel.ERROR, category, message, status, ...args);
  }

  // Specialized logging methods for common use cases
  success(category, message, ...args) {
    this.info(category, message, LogStatus.SUCCESS, ...args);
  }

  failure(category, message, ...args) {
    this.error(category, message, LogStatus.ERROR, ...args);
  }

  processing(category, message, ...args) {
    this.info(category, message, LogStatus.PROCESSING, ...args);
  }

  /**
   * Log file processing status
   */
  fileStatus(filename, status, details = '') {
    const message = details ? `${filename} ${details}` : filename;
    this.info(LogCategory.FILE, message, status);
  }

  /**
   * Log queue operations
   */
  queueStatus(message, ...args) {
    this.info(LogCategory.QUEUE, message, LogStatus.ARROW, ...args);
  }

  /**
   * Log API operations
   */
  apiCall(service, operation, details = '') {
    const message = details ? `${service} ${operation} - ${details}` : `${service} ${operation}`;
    this.debug(LogCategory.API, message);
  }

  apiSuccess(service, operation, details = '') {
    const message = details ? `${service} ${operation} - ${details}` : `${service} ${operation}`;
    this.success(LogCategory.API, message);
  }

  apiError(service, operation, error) {
    const message = `${service} ${operation} failed: ${error.message}`;
    this.failure(LogCategory.API, message);
  }

  /**
   * Log configuration and system status
   */
  systemStatus(message, success = true, ...args) {
    if (success) {
      this.success(LogCategory.SYSTEM, message, ...args);
    } else {
      this.failure(LogCategory.SYSTEM, message, ...args);
    }
  }

  configStatus(message, success = true, ...args) {
    if (success) {
      this.success(LogCategory.CONFIG, message, ...args);
    } else {
      this.failure(LogCategory.CONFIG, message, ...args);
    }
  }

  /**
   * Log validation results
   */
  validationResult(item, success = true, details = '') {
    const message = details ? `${item} - ${details}` : item;
    if (success) {
      this.success(LogCategory.VALIDATION, message);
    } else {
      this.failure(LogCategory.VALIDATION, message);
    }
  }

  /**
   * Log with custom formatting (for special cases)
   */
  raw(message, ...args) {
    console.log(message, ...args);
  }

  /**
   * Create a section separator for better readability
   */
  section(title) {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`\n=== ${title} ===`);
    }
  }

  /**
   * Create a subsection separator
   */
  subsection(title) {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`\n--- ${title} ---`);
    }
  }
}

// Create singleton instance
const logger = new Logger();

// Export both the class and singleton instance
export { Logger };
export default logger;
