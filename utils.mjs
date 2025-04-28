/**
 * Utility functions for the voice memo processing application
 */

/**
 * Creates a spinning animation in the console to indicate a long-running process
 * @param {string} message - The message to display alongside the spinner
 * @returns {Function} A function that stops the spinner when called
 */
export function startSpinner(message) {
  const spinnerChars = ['|', '/', '-', '\\'];
  let i = 0;
  process.stdout.write(message);
  const interval = setInterval(() => {
    process.stdout.write(`\r${message} ${spinnerChars[i++ % spinnerChars.length]}`);
  }, 100);
  return () => {
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(message.length + 2) + '\r');
  };
}

/**
 * Sanitizes a filename by removing invalid characters
 * @param {string} name - The name to sanitize
 * @returns {string} - Sanitized filename
 */
export function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').substring(0, 60);
}
