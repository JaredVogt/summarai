/**
 * ElevenLabs Subscription Monitor
 * Tracks and logs ElevenLabs API usage and subscription status
 */

import https from 'https';
import logger, { LogCategory, LogStatus } from './src/logger.mjs';

/**
 * Check and log ElevenLabs subscription status
 * @param {string} apiKey - ElevenLabs API key
 * @param {boolean} verbose - Whether to show detailed output
 */
export async function checkAndLogSubscription(apiKey, verbose = false) {
  if (!apiKey) {
    if (verbose) {
      logger.warn(LogCategory.API, 'ElevenLabs API key not provided - skipping subscription check');
    }
    return;
  }

  try {
    const subscriptionData = await fetchSubscriptionStatus(apiKey);
    formatAndLogSubscription(subscriptionData, verbose);
  } catch (error) {
    // Log warning but don't throw - transcription should continue
    logger.warn(LogCategory.API, `Failed to check ElevenLabs subscription: ${error.message}`);
  }
}

/**
 * Fetch subscription status from ElevenLabs API
 * @param {string} apiKey - ElevenLabs API key
 * @returns {Promise<Object>} Subscription data
 */
async function fetchSubscriptionStatus(apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      path: '/v1/user/subscription',
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsedData = JSON.parse(data);
            resolve(parsedData);
          } catch (parseError) {
            reject(new Error(`Failed to parse API response: ${parseError.message}`));
          }
        } else {
          reject(new Error(`API request failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Network error: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Format and log subscription information
 * @param {Object} data - Subscription data from API
 * @param {boolean} verbose - Whether to show detailed output
 */
function formatAndLogSubscription(data, verbose = false) {
  const {
    tier,
    character_count: used,
    character_limit: limit,
    next_character_count_reset_unix: resetUnix,
    voice_limit: voiceLimit,
    can_extend_character_limit: canExtend
  } = data;

  // Calculate usage percentage
  const usagePercent = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const remaining = Math.max(0, limit - used);

  // Determine status color based on usage
  let statusIcon = '🟢';
  let statusText = 'Good';
  if (usagePercent >= 80) {
    statusIcon = '🔴';
    statusText = 'Critical';
  } else if (usagePercent >= 50) {
    statusIcon = '🟡';
    statusText = 'Warning';
  }

  // Format reset time
  const resetTime = formatTimeUntilReset(resetUnix);

  // Log subscription status
  logger.info(LogCategory.API, `${LogStatus.INFO} ElevenLabs Subscription Status:`);
  logger.info(LogCategory.API, `  ${LogStatus.ARROW} Tier: ${tier || 'Unknown'}`);
  logger.info(LogCategory.API, `  ${LogStatus.ARROW} Usage: ${formatNumber(used)} / ${formatNumber(limit)} characters (${usagePercent}%) ${statusIcon}`);
  logger.info(LogCategory.API, `  ${LogStatus.ARROW} Remaining: ${formatNumber(remaining)} characters`);

  if (resetTime) {
    logger.info(LogCategory.API, `  ${LogStatus.ARROW} Resets in: ${resetTime}`);
  }

  if (verbose) {
    if (voiceLimit) {
      logger.info(LogCategory.API, `  ${LogStatus.ARROW} Voice limit: ${voiceLimit} voices`);
    }
    if (canExtend !== undefined) {
      logger.info(LogCategory.API, `  ${LogStatus.ARROW} Can extend limit: ${canExtend ? 'Yes' : 'No'}`);
    }
    logger.info(LogCategory.API, `  ${LogStatus.ARROW} Status: ${statusText}`);
  }

  // Show warning if usage is high
  if (usagePercent >= 80) {
    logger.warn(LogCategory.API, `${LogStatus.WARNING} High usage detected! Consider monitoring your API consumption.`);
  }
}

/**
 * Format large numbers with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
  if (typeof num !== 'number') return 'Unknown';
  return num.toLocaleString();
}

/**
 * Format time until reset in human-readable format
 * @param {number} resetUnix - Unix timestamp of reset
 * @returns {string} Human-readable time string
 */
function formatTimeUntilReset(resetUnix) {
  if (!resetUnix) return null;

  const now = Math.floor(Date.now() / 1000);
  const secondsUntilReset = resetUnix - now;

  if (secondsUntilReset <= 0) {
    return 'Soon (overdue)';
  }

  const days = Math.floor(secondsUntilReset / (24 * 60 * 60));
  const hours = Math.floor((secondsUntilReset % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((secondsUntilReset % (60 * 60)) / 60);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}${hours > 0 ? `, ${hours} hour${hours > 1 ? 's' : ''}` : ''}`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}${minutes > 0 ? `, ${minutes} minute${minutes > 1 ? 's' : ''}` : ''}`;
  } else {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
}