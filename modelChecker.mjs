import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use a safe cache file path that works in both development and executable modes
const getCacheFilePath = () => {
  const isExecutable = typeof Bun !== 'undefined' && process.argv[0]?.includes('summari');

  if (isExecutable) {
    const cacheDir = process.env.XDG_CACHE_HOME ||
                     path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.cache');
    return path.join(cacheDir, 'summarai-model-cache.json');
  } else {
    return path.join(__dirname, '.model-cache.json');
  }
};

const CACHE_FILE = getCacheFilePath();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const MODELS_API_URL = 'https://api.anthropic.com/v1/models';

// Hardcoded fallback when API is unreachable and no cache exists
export const FALLBACK_MODEL = 'claude-opus-4-20250514';

// Memory cache for Bun executables (VFS-compatible)
let memoryCache = null;

/**
 * Parse a model ID into family and date components.
 * Generic — works with any Claude model naming convention.
 * e.g., "claude-opus-4-20250514" → { family: "claude-opus-4", date: "20250514" }
 * e.g., "claude-sonnet-4-5-20250929" → { family: "claude-sonnet-4-5", date: "20250929" }
 * e.g., "claude-opus-4-6-20250925" → { family: "claude-opus-4-6", date: "20250925" }
 */
function parseModelId(modelId) {
  const match = modelId.match(/^(claude-.+)-(\d{8})$/);
  if (!match) return null;
  return { family: match[1], date: match[2], id: modelId };
}

/**
 * Extract the tier (opus, sonnet, haiku) from a model family or ID.
 * Works for any current or future version number.
 */
function getTier(familyOrId) {
  const match = familyOrId.match(/^claude-(opus|sonnet|haiku)/);
  return match ? match[1] : null;
}

/**
 * Load cached model data (VFS-compatible)
 */
function loadCache() {
  const isExecutable = typeof Bun !== 'undefined' && process.argv[0]?.includes('summari');

  if (isExecutable) {
    if (memoryCache && memoryCache.families && (Date.now() - memoryCache.timestamp < CACHE_DURATION)) {
      return memoryCache;
    }
    return null;
  } else {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        // Require new cache format with 'families' key
        if (data.families && (Date.now() - data.timestamp < CACHE_DURATION)) {
          return data;
        }
      }
    } catch (error) {
      console.warn('[ModelChecker] Cache load failed:', error.message);
    }
    return null;
  }
}

/**
 * Save model data to cache (VFS-compatible)
 */
function saveCache(data) {
  const isExecutable = typeof Bun !== 'undefined' && process.argv[0]?.includes('summari');

  if (isExecutable) {
    memoryCache = data;
  }

  // Always try to save to filesystem
  try {
    const cacheDir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('[ModelChecker] Cache save failed:', error.message);
  }
}

/**
 * Fetch all available models from the Anthropic API (paginated)
 */
async function fetchModelsFromApi() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const allModels = [];
  let afterId = undefined;

  do {
    const params = { limit: 100 };
    if (afterId) params.after_id = afterId;

    const response = await axios.get(MODELS_API_URL, {
      params,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      timeout: 10000
    });

    if (response.data?.data) {
      allModels.push(...response.data.data);
    }

    if (response.data?.has_more && response.data?.last_id) {
      afterId = response.data.last_id;
    } else {
      break;
    }
  } while (true);

  return allModels;
}

/**
 * Build a map of { family → latest model info } from the raw API model list.
 * Completely generic — new model families are discovered automatically.
 */
function buildFamilyMap(apiModels) {
  const families = {};

  for (const model of apiModels) {
    const parsed = parseModelId(model.id);
    if (!parsed) continue;

    // Only track if we recognize the tier (opus, sonnet, haiku)
    if (!getTier(parsed.family)) continue;

    if (!families[parsed.family] || parsed.date > families[parsed.family].date) {
      families[parsed.family] = {
        ...parsed,
        displayName: model.display_name || model.id,
        createdAt: model.created_at
      };
    }
  }

  return families;
}

/**
 * Fetch latest models with caching.
 * Uses the Anthropic /v1/models API — no HTML scraping.
 */
export async function fetchLatestModels(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadCache();
    if (cached) return cached;
  }

  try {
    const { default: logger, LogCategory } = await import('./src/logger.mjs');
    logger.debug(LogCategory.MODEL, 'Fetching available models from Anthropic API...');

    const apiModels = await fetchModelsFromApi();
    if (!apiModels) {
      logger.warn(LogCategory.MODEL, 'No API key available for model lookup');
      return loadCache() || { families: {}, timestamp: Date.now() };
    }

    const families = buildFamilyMap(apiModels);
    const result = { families, timestamp: Date.now() };
    saveCache(result);
    return result;
  } catch (error) {
    const { default: logger, LogCategory } = await import('./src/logger.mjs');
    logger.warn(LogCategory.MODEL, `Error fetching models: ${error.message}`);
    const cached = loadCache();
    if (cached) {
      logger.warn(LogCategory.MODEL, 'Using expired cache due to fetch error');
      return cached;
    }
    return { families: {}, timestamp: Date.now() };
  }
}

/**
 * Resolve a model shorthand or full ID to a specific model ID.
 * Supports tier shorthands: "opus", "sonnet", "haiku" → latest model of that tier.
 * Full model IDs (e.g., "claude-opus-4-20250514") are returned as-is.
 */
export async function resolveModel(modelConfig) {
  if (!modelConfig) return null;

  const tierName = modelConfig.toLowerCase();
  const tiers = ['opus', 'sonnet', 'haiku'];

  if (!tiers.includes(tierName)) {
    // Full model ID — return as-is
    return modelConfig;
  }

  // Resolve shorthand to the latest model of that tier
  const data = await fetchLatestModels();
  const families = data.families || {};

  let best = null;
  for (const info of Object.values(families)) {
    if (getTier(info.family) === tierName) {
      if (!best || info.date > best.date || (info.date === best.date && info.id > best.id)) {
        best = info;
      }
    }
  }

  return best?.id || null;
}

/**
 * Check if a newer model is available in the same tier.
 * Only logs when a newer model is found — no noise when up to date.
 */
export async function checkForNewerModels(currentModel, silent = false) {
  const data = await fetchLatestModels();
  const families = data.families || {};
  const results = {
    currentModel,
    hasNewer: false,
    newerModels: []
  };

  const parsed = parseModelId(currentModel);
  if (!parsed) {
    if (!silent) {
      const { default: logger, LogCategory } = await import('./src/logger.mjs');
      logger.warn(LogCategory.MODEL, `Unable to parse model format: ${currentModel}`);
    }
    return results;
  }

  const currentTier = getTier(parsed.family);
  if (!currentTier) return results;

  // Find the absolute latest model in the same tier (across all families)
  let tierBest = null;
  for (const info of Object.values(families)) {
    if (getTier(info.family) === currentTier) {
      if (!tierBest || info.date > tierBest.date || (info.date === tierBest.date && info.id > tierBest.id)) {
        tierBest = info;
      }
    }
  }

  if (tierBest && tierBest.id !== currentModel) {
    results.hasNewer = true;
    results.newerModels.push({
      current: currentModel,
      latest: tierBest.id
    });

    if (!silent) {
      const { default: logger, LogCategory } = await import('./src/logger.mjs');
      logger.info(LogCategory.MODEL, `Newer ${currentTier} model available: ${tierBest.id}`);
      logger.info(LogCategory.MODEL, `Set claude.model to "${currentTier}" in config.yaml for auto-latest`);
    }
  }

  return results;
}

// Allow running directly for testing
if (import.meta.url === `file://${process.argv[1]}` &&
    !process.argv[1]?.includes('summarai') &&
    !process.argv[1]?.includes('release/summarai')) {
  const testInput = process.argv[2] || 'opus';
  console.log(`Testing with input: ${testInput}\n`);

  (async () => {
    try {
      const resolved = await resolveModel(testInput);
      console.log(`Resolved: ${resolved}\n`);

      if (resolved) {
        const results = await checkForNewerModels(resolved);
        console.log('\nResults:', JSON.stringify(results, null, 2));
      }
    } catch (error) {
      console.error('Error:', error.message);
    }
  })();
}
