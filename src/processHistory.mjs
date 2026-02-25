import fs from 'fs';
import path from 'path';
import { getConfigValue } from '../configLoader.mjs';

function resolveHistoryPath(config) {
  const file = getConfigValue(config, 'fileProcessing.history.file', './processed_log.ndjson');
  const p = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  return p;
}

function resolveLegacyArrayPath(config) {
  const hist = resolveHistoryPath(config);
  const dir = path.dirname(hist);
  return path.join(dir, 'process_history.json');
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readLegacyArray(pathCandidate) {
  try {
    if (!fs.existsSync(pathCandidate)) return null;
    const raw = fs.readFileSync(pathCandidate, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    // Support legacy object shape: { processedFiles: [...] }
    if (parsed && Array.isArray(parsed.processedFiles)) {
      // Normalize to array of { filename, timestamp }
      return parsed.processedFiles.map(it => ({
        filename: it.filename || it.originalFileName || it.file || null,
        timestamp: it.timestamp || it.processedAt || null
      })).filter(x => x.filename);
    }
    return null;
  } catch { return null; }
}

/**
 * Search watch directories for a file by name
 * @param {string} filename - The filename to search for
 * @param {Object} config - The config object containing watch directories
 * @returns {string|null} - Full path if found, null otherwise
 */
function findFileInWatchDirs(filename, config) {
  if (!filename || !config) return null;

  // Get watch directories from config
  const watchDirs = getConfigValue(config, 'directories.watch', {});
  if (!watchDirs || typeof watchDirs !== 'object') return null;

  for (const [, dirConfig] of Object.entries(watchDirs)) {
    if (!dirConfig || !dirConfig.path) continue;

    // Resolve the path (could be relative)
    const dirPath = path.isAbsolute(dirConfig.path)
      ? dirConfig.path
      : path.resolve(process.cwd(), dirConfig.path);

    // Check if file exists in this directory
    const fullPath = path.join(dirPath, filename);
    try {
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    } catch {
      // Skip directories we can't access
    }
  }

  return null;
}

function migrateLegacyIfPresent(config) {
  const ndjsonPath = resolveHistoryPath(config);
  const legacyPath = resolveLegacyArrayPath(config);
  if (fs.existsSync(ndjsonPath)) return; // already migrated/created

  // Only check for legacy file in the same directory as the NDJSON file
  // This ensures test isolation and respects the configured location
  const arr = readLegacyArray(legacyPath);
  if (!arr) return;
  ensureDir(ndjsonPath);
  const fh = fs.openSync(ndjsonPath, 'a');
  try {
    for (const item of arr) {
      const filename = item.filename || null;
      // Try to find the file in watch directories to backfill sourcePath
      const sourcePath = filename ? findFileInWatchDirs(filename, config) : null;

      const rec = {
        processedAt: item.timestamp || new Date().toISOString(),
        sourcePath: sourcePath,
        sourceName: filename,
        destAudioPath: null,
        outputMdPath: null,
        service: null,
        model: null,
        sizeSourceBytes: null,
        sizeDestBytes: null
      };
      fs.writeSync(fh, JSON.stringify(rec) + '\n');
    }
  } finally {
    fs.closeSync(fh);
  }
}

function appendRecord(config, record) {
  const ndjsonPath = resolveHistoryPath(config);
  ensureDir(ndjsonPath);
  const safe = {
    processedAt: record.processedAt || new Date().toISOString(),
    sourcePath: record.sourcePath ?? null,
    sourceName: record.sourceName ?? (record.sourcePath ? path.basename(record.sourcePath) : null),
    destAudioPath: record.destAudioPath ?? null,
    outputMdPath: record.outputMdPath ?? null,
    service: record.service ?? null,
    model: record.model ?? null,
    sizeSourceBytes: Number.isFinite(record.sizeSourceBytes) ? record.sizeSourceBytes : null,
    sizeDestBytes: Number.isFinite(record.sizeDestBytes) ? record.sizeDestBytes : null,
    status: 'success'
  };
  try {
    fs.appendFileSync(ndjsonPath, JSON.stringify(safe) + '\n');
  } catch (err) {
    // As a last resort, log to console without throwing to avoid breaking processing
    console.error(`Failed to append to NDJSON history: ${err.message}`);
  }
}

function appendFailureRecord(config, record) {
  const ndjsonPath = resolveHistoryPath(config);
  ensureDir(ndjsonPath);
  const safe = {
    processedAt: record.processedAt || new Date().toISOString(),
    sourcePath: record.sourcePath ?? null,
    sourceName: record.sourceName ?? (record.sourcePath ? path.basename(record.sourcePath) : null),
    status: 'failed',
    attemptNumber: Number.isFinite(record.attemptNumber) ? record.attemptNumber : null,
    error: record.error ? {
      type: record.error.type || record.error.name || 'Error',
      message: record.error.message || 'Unknown error',
      code: record.error.code ?? null,
      service: record.error.service ?? null
    } : null
  };
  try {
    fs.appendFileSync(ndjsonPath, JSON.stringify(safe) + '\n');
  } catch (err) {
    console.error(`Failed to append failure record to NDJSON history: ${err.message}`);
  }
}

function loadIndex(config) {
  migrateLegacyIfPresent(config);
  const ndjsonPath = resolveHistoryPath(config);
  const bySourceName = new Set();
  const bySourcePath = new Set();
  const failedFiles = new Map(); // sourcePath or sourceName -> { error, attemptNumber, lastAttemptAt }

  if (!fs.existsSync(ndjsonPath)) return { bySourceName, bySourcePath, failedFiles };

  try {
    const data = fs.readFileSync(ndjsonPath, 'utf8');
    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        // Accept records with either sourcePath OR sourceName
        if (!obj || (!obj.sourcePath && !obj.sourceName)) continue;

        const status = obj.status || 'success'; // default for backward compatibility
        // Use sourcePath as primary key, fall back to sourceName for legacy records
        const recordKey = obj.sourcePath || obj.sourceName;

        if (status === 'success') {
          // Successfully processed - add to success Sets and remove from failures
          if (obj.sourceName) bySourceName.add(obj.sourceName);
          if (obj.sourcePath) bySourcePath.add(obj.sourcePath);
          failedFiles.delete(recordKey);
        } else if (status === 'failed') {
          // Failed - track in failedFiles Map (unless later succeeded)
          const isAlreadySuccessful = obj.sourcePath
            ? bySourcePath.has(obj.sourcePath)
            : bySourceName.has(obj.sourceName);

          if (!isAlreadySuccessful) {
            failedFiles.set(recordKey, {
              error: obj.error || null,
              attemptNumber: obj.attemptNumber || 1,
              lastAttemptAt: obj.processedAt || null,
              sourceName: obj.sourceName || (obj.sourcePath ? path.basename(obj.sourcePath) : null)
            });
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch (err) {
    console.warn(`Warning: Could not read NDJSON history: ${err.message}`);
  }

  return { bySourceName, bySourcePath, failedFiles };
}

export { resolveHistoryPath, migrateLegacyIfPresent, appendRecord, appendFailureRecord, loadIndex, findFileInWatchDirs };
