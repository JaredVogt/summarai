/**
 * Shared retry utility for API calls with exponential backoff
 */

/**
 * Default function to determine if an error should trigger a retry
 * @param {Error} error - The error to check
 * @returns {boolean} - True if the error should trigger a retry
 */
export function defaultShouldRetry(error) {
  // Network/connection errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }
  
  // HTTP status codes (if using axios or similar)
  if (error.response) {
    const status = error.response.status;
    // Retry on server errors
    if (status >= 500 && status < 600) return true;
    // Retry on rate limiting
    if (status === 429) return true;
    // Retry on request timeout
    if (status === 408) return true;
  }
  
  // Specific error messages
  if (error.message) {
    // ElevenLabs stream error
    if (error.message.includes('Response body object should not be disturbed or locked')) return true;
    // Timeout errors
    if (error.message.includes('timeout') || error.message.includes('Timeout')) return true;
  }
  
  return false;
}

/**
 * Calculate retry delay with exponential backoff
 * @param {number} attempt - Current attempt number (0-based)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number} - Delay in milliseconds
 */
export function calculateRetryDelay(attempt, baseDelay = 1000, maxDelay = 30000) {
  const delay = baseDelay * Math.pow(2, attempt);
  return Math.min(delay, maxDelay);
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in milliseconds (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in milliseconds (default: 30000)
 * @param {Function} options.shouldRetry - Function to determine if retry should happen (default: defaultShouldRetry)
 * @param {Function} options.onRetry - Callback function called before each retry
 * @param {string} options.operation - Operation name for logging
 * @returns {Promise} - Result of the function
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = parseInt(process.env.API_MAX_RETRIES) || 3,
    baseDelay = parseInt(process.env.API_RETRY_BASE_DELAY) || 1000,
    maxDelay = parseInt(process.env.API_RETRY_MAX_DELAY) || 30000,
    shouldRetry = defaultShouldRetry,
    onRetry = null,
    operation = 'API call'
  } = options;
  
  let lastError;
  const startTime = Date.now();
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // If this is a retry, log it
      if (attempt > 0) {
        const delay = calculateRetryDelay(attempt - 1, baseDelay, maxDelay);
        console.log(`[Retry] Attempt ${attempt}/${maxRetries} for ${operation} after ${delay}ms delay`);
        
        // Call onRetry callback if provided
        if (onRetry) {
          await onRetry(attempt, lastError);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // Try the function
      return await fn();
      
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt < maxRetries && shouldRetry(error)) {
        console.log(`[Retry] ${operation} failed with retryable error: ${error.message}`);
        continue;
      }
      
      // No more retries or non-retryable error
      const totalTime = Date.now() - startTime;
      console.error(`[Retry] ${operation} failed after ${attempt + 1} attempts (${totalTime}ms total)`);
      throw error;
    }
  }
  
  // Should never reach here, but just in case
  throw lastError;
}

/**
 * Sleep/delay utility function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after the delay
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}