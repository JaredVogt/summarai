import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, '.model-cache.json');
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const MODELS_URL = 'https://docs.anthropic.com/en/docs/about-claude/models/overview';

/**
 * Extract model information from the Anthropic docs HTML
 * @param {string} html - The HTML content
 * @returns {Object} - Object with latest model info
 */
function parseModelsFromHtml(html) {
  const models = {
    opus4: null,
    sonnet4: null,
    timestamp: Date.now()
  };

  try {
    // Look for Opus 4 model identifier pattern
    const opus4Pattern = /claude-opus-4-\d{8}/g;
    const opus4Matches = html.match(opus4Pattern);
    if (opus4Matches && opus4Matches.length > 0) {
      // Get the most recent (assuming format is YYYYMMDD)
      models.opus4 = opus4Matches.sort().reverse()[0];
    }

    // Look for Sonnet 4 model identifier pattern
    const sonnet4Pattern = /claude-sonnet-4-\d{8}/g;
    const sonnet4Matches = html.match(sonnet4Pattern);
    if (sonnet4Matches && sonnet4Matches.length > 0) {
      // Get the most recent (assuming format is YYYYMMDD)
      models.sonnet4 = sonnet4Matches.sort().reverse()[0];
    }

    // Also check for any alias patterns like claude-opus-4-0
    const opus4AliasPattern = /claude-opus-4-0/g;
    if (!models.opus4 && opus4AliasPattern.test(html)) {
      models.opus4Alias = 'claude-opus-4-0';
    }

    const sonnet4AliasPattern = /claude-sonnet-4-0/g;
    if (!models.sonnet4 && sonnet4AliasPattern.test(html)) {
      models.sonnet4Alias = 'claude-sonnet-4-0';
    }

  } catch (error) {
    console.error('[ModelChecker] Error parsing models from HTML:', error.message);
  }

  return models;
}

/**
 * Load cached model data
 * @returns {Object|null} - Cached data or null if expired/not found
 */
function loadCache() {
  // Disable caching when running as executable to avoid virtual filesystem issues
  if (process.argv[1]?.includes('watchDirectories')) {
    return null;
  }
  
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      // Check if cache is still valid
      if (Date.now() - data.timestamp < CACHE_DURATION) {
        return data;
      }
    }
  } catch (error) {
    console.error('[ModelChecker] Error loading cache:', error.message);
  }
  return null;
}

/**
 * Save model data to cache
 * @param {Object} data - Model data to cache
 */
function saveCache(data) {
  // Disable caching when running as executable to avoid virtual filesystem issues
  if (process.argv[1]?.includes('watchDirectories')) {
    return;
  }
  
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[ModelChecker] Error saving cache:', error.message);
  }
}

/**
 * Fetch latest Claude models from Anthropic docs
 * @param {boolean} forceRefresh - Force refresh ignoring cache
 * @returns {Promise<Object>} - Object with latest model info
 */
export async function fetchLatestModels(forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = loadCache();
    if (cached) {
      return cached;
    }
  }

  try {
    console.log('[ModelChecker] Checking for latest Claude models...');
    
    const response = await axios.get(MODELS_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const models = parseModelsFromHtml(response.data);
    
    // Save to cache
    saveCache(models);
    
    return models;
  } catch (error) {
    console.error('[ModelChecker] Error fetching models:', error.message);
    // Return cached data if available, even if expired
    const cached = loadCache();
    if (cached) {
      console.log('[ModelChecker] Using expired cache due to fetch error');
      return cached;
    }
    // Return empty models if no cache
    return {
      opus4: null,
      sonnet4: null,
      timestamp: Date.now()
    };
  }
}

/**
 * Check if a newer model is available
 * @param {string} currentModel - Currently used model identifier
 * @param {boolean} silent - If true, don't log to console
 * @returns {Promise<Object>} - Object with comparison results
 */
export async function checkForNewerModels(currentModel, silent = false) {
  const models = await fetchLatestModels();
  const results = {
    currentModel,
    hasNewer: false,
    newerModels: []
  };

  // Extract model type and date from current model
  const modelMatch = currentModel.match(/(claude-(?:opus|sonnet)-4)-(\d{8})/);
  if (!modelMatch) {
    if (!silent) {
      console.log('[ModelChecker] Unable to parse current model format');
    }
    return results;
  }

  const [_, modelType, currentDate] = modelMatch;
  
  // Check if newer version exists
  if (modelType === 'claude-opus-4' && models.opus4) {
    const latestDate = models.opus4.match(/\d{8}/)?.[0];
    if (latestDate && latestDate > currentDate) {
      results.hasNewer = true;
      results.newerModels.push({
        type: 'opus4',
        current: currentModel,
        latest: models.opus4
      });
    }
  } else if (modelType === 'claude-sonnet-4' && models.sonnet4) {
    const latestDate = models.sonnet4.match(/\d{8}/)?.[0];
    if (latestDate && latestDate > currentDate) {
      results.hasNewer = true;
      results.newerModels.push({
        type: 'sonnet4',
        current: currentModel,
        latest: models.sonnet4
      });
    }
  }

  // Log findings if not silent
  if (!silent && results.hasNewer) {
    console.log('\n[Info] Newer Claude models available:');
    results.newerModels.forEach(model => {
      console.log(`- ${model.latest} (currently using: ${model.current})`);
    });
    console.log('To update, modify the model in claudeAPI.mjs\n');
  } else if (!silent && !results.hasNewer) {
    console.log('[ModelChecker] You are using the latest available model');
  }

  // Also show other available models if different type
  if (!silent && models.opus4 && !currentModel.includes('opus')) {
    console.log(`[Info] Opus 4 available: ${models.opus4}`);
  }
  if (!silent && models.sonnet4 && !currentModel.includes('sonnet')) {
    console.log(`[Info] Sonnet 4 available: ${models.sonnet4}`);
  }

  return results;
}

// Allow running directly for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const testModel = process.argv[2] || 'claude-opus-4-20250514';
  console.log(`Testing with model: ${testModel}\n`);
  
  checkForNewerModels(testModel)
    .then(results => {
      console.log('\nResults:', JSON.stringify(results, null, 2));
    })
    .catch(error => {
      console.error('Error:', error.message);
    });
}