#!/usr/bin/env node

// Load environment variables FIRST
import './env.mjs';

// Parse command line arguments FIRST, before other imports
const args = process.argv.slice(2);
const cleanoutMode = args.includes('--cleanout');
const dryRunMode = args.includes('--dry-run');
const showHelp = args.includes('--help') || args.includes('-h');
const showVersion = args.includes('--version') || args.includes('-v');

// Get version info
function getVersionInfo() {
  // Try to get version from build-time defines first (for compiled executable)
  if (typeof BUILD_VERSION !== 'undefined') {
    return {
      version: BUILD_VERSION,
      buildDate: BUILD_DATE || 'unknown',
      buildTime: BUILD_TIME || 'unknown'
    };
  }

  // Fallback to package.json for development
  try {
    const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    return {
      version: packageJson.version,
      buildDate: 'development',
      buildTime: 'development'
    };
  } catch {
    return {
      version: 'unknown',
      buildDate: 'unknown',
      buildTime: 'unknown'
    };
  }
}

// Version check will be handled after imports

// Show help immediately if requested, before any imports
if (showHelp) {
  logger.raw(`
Usage: summarai [options]

Options:
  --cleanout                        Process all existing files in Google Drive unprocessed folder before watching
  --process-recent-vm [date-range]  Process unprocessed Voice Memos from specified date range
                                    Formats: MM-DD-YY (from date to now)
                                            MM-DD-YY:MM-DD-YY (date range)
                                            (no date = last 120 days)
  --dry-run                         When used with --process-recent-vm, show what would be processed without actually processing
  --version, -v                     Show version information
  --help, -h                        Show this help message

This tool watches for new audio/video files in:
- Apple Voice Memos directory
- Google Drive unprocessed directory

Files from Google Drive are moved to processed folder after successful processing.
Voice Memos files are never moved.

Examples:
  summarai --process-recent-vm                       # Process Voice Memos from last 120 days
  summarai --process-recent-vm --dry-run             # See what would be processed (last 120 days)
  summarai --process-recent-vm 7-1-25                # Process from July 1, 2025 to now
  summarai --process-recent-vm 4-1-25:5-31-25        # Process from April 1 to May 31, 2025
  summarai --process-recent-vm 7-1-25 --dry-run      # Dry run from July 1, 2025 to now
  summarai --cleanout                                # Process Google Drive files then watch
  `);
  process.exit(0);
}

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { processVoiceMemo } from './transcribe.mjs';
import { cleanupTempDir } from './audioProcessing.mjs';
import { loadConfig, getConfigValue, getLastConfigPath } from './configLoader.mjs';
import logger, { LogCategory, LogStatus } from './src/logger.mjs';
import { appendRecord, appendFailureRecord, loadIndex } from './src/processHistory.mjs';
import { ValidationError } from './src/validation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Show version immediately if requested, after imports
if (showVersion) {
  const versionInfo = getVersionInfo();
  console.log(`summarai v${versionInfo.version.replace(/"/g, '')}`);
  const buildTime = versionInfo.buildTime.replace(/"/g, '');
  const timeOnly = buildTime.includes('T') ? buildTime.split('T')[1]?.split('.')[0] : '';
  console.log(`Build: ${versionInfo.buildDate.replace(/"/g, '')} ${timeOnly}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  process.exit(0);
}

/**
 * Prompt user for input using readline
 * @param {string} question - Question to ask the user
 * @returns {Promise<string>} - User's response
 */
function askUser(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Helper to expand ~ and resolve paths
 * @param {string} filepath - File path to expand
 * @returns {string} - Expanded absolute path
 */
function expandPath(filepath) {
  if (!filepath) return null;
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return path.resolve(filepath);
}

/**
 * Load all directory configurations from config
 * @returns {Array} - Array of directory configuration objects
 */
function loadDirectoryConfigs() {
  const watchDirs = getConfigValue(config, 'directories.watch', {});
  
  return Object.keys(watchDirs).map(key => {
    const dir = watchDirs[key];
    return {
      name: dir.name,
      watchPath: expandPath(dir.path),
      processedPath: dir.processedPath ? expandPath(dir.processedPath) : null,
      enabled: dir.enabled !== false,
      moveAfterProcessing: dir.moveAfterProcessing || false,
      outputPath: dir.outputPath ? expandPath(dir.outputPath) : './output',
      processingOptions: {
        transcriptionService: dir.transcriptionService,
        compress: dir.compress,
        bitrate: dir.bitrate,
        maxSpeakers: dir.maxSpeakers,
        diarize: dir.diarize,
        model: dir.model
      }
    };
  });
}

/**
 * Find which directory config a file belongs to
 * @param {string} filePath - Path to the file
 * @param {Array} directoryConfigs - Array of directory configurations
 * @returns {Object|null} - Directory configuration or null if not found
 */
function getFileDirectoryConfig(filePath, directoryConfigs) {
  for (const config of directoryConfigs) {
    if (filePath.startsWith(config.watchPath)) {
      return config;
    }
  }
  return null;
}

// Load configuration
let config;
try {
  config = loadConfig();
  logger.configStatus('Configuration loaded successfully', true);
  const loadedConfigPath = getLastConfigPath?.();
  if (loadedConfigPath) {
    logger.info(LogCategory.CONFIG, `Using config: ${loadedConfigPath}`);
  }
} catch (error) {
  logger.configStatus(`Error loading configuration: ${error.message}`, false);
  logger.error(LogCategory.CONFIG, 'Please ensure config.yaml exists and is valid');
  process.exit(1);
}

// Parse --process-recent-vm with optional date range
let processRecentVmMode = false;
let dateRangeValue = null;
const processRecentVmIndex = args.findIndex(arg => arg === '--process-recent-vm');
if (processRecentVmIndex !== -1) {
  processRecentVmMode = true;
  // Check if there's a date range value after the flag
  if (processRecentVmIndex + 1 < args.length && 
      !args[processRecentVmIndex + 1].startsWith('--')) {
    dateRangeValue = args[processRecentVmIndex + 1];
  }
}

// Show help if requested
if (showHelp) {
  console.log(`
Usage: summarai [options]

Options:
  --cleanout                        Process all existing files in Google Drive unprocessed folder before watching
  --process-recent-vm [date-range]  Process unprocessed Voice Memos from specified date range
                                    Formats: MM-DD-YY (from date to now)
                                            MM-DD-YY:MM-DD-YY (date range)
                                            (no date = last 120 days)
  --dry-run                         When used with --process-recent-vm, show what would be processed without actually processing
  --help, -h                        Show this help message

This tool watches for new audio/video files in:
- Apple Voice Memos directory
- Google Drive unprocessed directory

Files from Google Drive are moved to processed folder after successful processing.
Voice Memos files are never moved.

Examples:
  summarai --process-recent-vm                       # Process Voice Memos from last 120 days
  summarai --process-recent-vm --dry-run             # See what would be processed (last 120 days)
  summarai --process-recent-vm 7-1-25                # Process from July 1, 2025 to now
  summarai --process-recent-vm 4-1-25:5-31-25        # Process from April 1 to May 31, 2025
  summarai --process-recent-vm 7-1-25 --dry-run      # Dry run from July 1, 2025 to now
  summarai --cleanout                                # Process Google Drive files then watch
  `);
  process.exit(0);
}

// Global directory configurations - loaded once at startup
let directoryConfigs = [];

// Supported file extensions from config
const AUDIO_EXTENSIONS = getConfigValue(config, 'fileProcessing.supportedExtensions.audio', []);
const VIDEO_EXTENSIONS = getConfigValue(config, 'fileProcessing.supportedExtensions.video', []);

// Ensure arrays are valid and flatten if needed
const safeAudioExts = Array.isArray(AUDIO_EXTENSIONS) ? AUDIO_EXTENSIONS : ['.m4a', '.mp3', '.wav'];
const safeVideoExts = Array.isArray(VIDEO_EXTENSIONS) ? VIDEO_EXTENSIONS : ['.mp4', '.mov'];
const SUPPORTED_EXTENSIONS = [...safeAudioExts, ...safeVideoExts];

// Track processed files to avoid duplicates
const processed = new Set();

// Processing queue to ensure sequential file processing
const processingQueue = [];
let isProcessingQueue = false;

// Retry mechanism
const retryCount = new Map(); // filePath -> attemptNumber
const retryTimeouts = new Map(); // filePath -> timeoutId

/**
 * Check if a file has a supported extension and is not a temp file
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if supported
 */
function isSupportedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const dirname = path.dirname(filePath);
  
  // Get ignore patterns from config
  const ignorePatterns = getConfigValue(config, 'fileProcessing.ignore.patterns', []);
  const ignoreDirs = getConfigValue(config, 'fileProcessing.ignore.directories', []);
  
  // Ensure arrays are valid
  const safeIgnorePatterns = Array.isArray(ignorePatterns) ? ignorePatterns : [];
  const safeIgnoreDirs = Array.isArray(ignoreDirs) ? ignoreDirs : [];
  
  // Check ignore patterns
  for (const pattern of safeIgnorePatterns) {
    if (pattern.includes('*')) {
      // Simple wildcard matching
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(basename)) return false;
    } else {
      if (basename.startsWith(pattern.replace('*', ''))) return false;
    }
  }
  
  // Check ignore directories
  for (const dir of safeIgnoreDirs) {
    if (dirname.includes(dir)) return false;
  }
  
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Determine the source directory of a file
 * @param {string} filePath - Path to the file
 * @returns {string} - Directory name or 'unknown'
 */
function getFileSource(filePath) {
  const dirConfig = getFileDirectoryConfig(filePath, directoryConfigs);
  return dirConfig ? dirConfig.name : 'unknown';
}

/**
 * Create a lock file to prevent concurrent processing
 * @param {string} filePath - Path to the file being processed
 * @returns {string} - Path to the lock file
 */
function createLockFile(filePath) {
  const lockPath = `${filePath}.processing`;
  fs.writeFileSync(lockPath, new Date().toISOString());
  return lockPath;
}

/**
 * Remove a lock file
 * @param {string} lockPath - Path to the lock file
 */
function removeLockFile(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    // Ignore errors if file doesn't exist
  }
}

/**
 * Clean up orphaned lock files on startup
 * Removes all .processing lock files from watched directories
 */
function cleanupOrphanedLocks() {
  logger.section('Cleaning up orphaned lock files');

  const configs = loadDirectoryConfigs();
  let cleanedCount = 0;

  for (const dirConfig of configs) {
    if (!dirConfig.enabled) continue;

    const watchPath = dirConfig.watchPath;
    if (!fs.existsSync(watchPath)) continue;

    try {
      // Find all .processing files in the watched directory
      const files = fs.readdirSync(watchPath);
      for (const file of files) {
        if (file.endsWith('.processing')) {
          const lockPath = path.join(watchPath, file);
          try {
            fs.unlinkSync(lockPath);
            cleanedCount++;
            logger.info(LogCategory.PROCESSING, `Removed orphaned lock: ${file}`);
          } catch (err) {
            logger.warning(LogCategory.PROCESSING, `Failed to remove lock ${file}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      logger.warning(LogCategory.PROCESSING, `Error scanning ${dirConfig.name}: ${err.message}`);
    }
  }

  if (cleanedCount > 0) {
    logger.success(LogCategory.PROCESSING, `Cleaned up ${cleanedCount} orphaned lock file(s)`);
  } else {
    logger.info(LogCategory.PROCESSING, 'No orphaned lock files found');
  }
}

/**
 * Recover previously failed files on startup
 * Loads failed files from history and adds them back to the processing queue
 */
function recoverFailedFiles() {
  logger.section('Recovering previously failed files');

  const { failedFiles } = loadIndex(config);

  if (failedFiles.size === 0) {
    logger.info(LogCategory.PROCESSING, 'No previously failed files to recover');
    return;
  }

  let recoveredCount = 0;
  let skippedCount = 0;

  for (const [filePath, failureInfo] of failedFiles) {
    // Check if file still exists
    if (!fs.existsSync(filePath)) {
      logger.info(LogCategory.PROCESSING, `Skipping missing file: ${failureInfo.sourceName}`);
      skippedCount++;
      continue;
    }

    // Add to processing queue
    addToQueue(filePath);
    recoveredCount++;

    const errorMsg = failureInfo.error?.message || 'Unknown error';
    logger.info(LogCategory.PROCESSING,
      `Queued for retry: ${failureInfo.sourceName} (last error: ${errorMsg})`);
  }

  if (recoveredCount > 0) {
    logger.success(LogCategory.PROCESSING,
      `Queued ${recoveredCount} failed file(s) for retry`);
  }
  if (skippedCount > 0) {
    logger.info(LogCategory.PROCESSING,
      `Skipped ${skippedCount} missing file(s)`);
  }
}

/**
 * Ensure the tail of a file is readable, indicating the file has fully hydrated
 * from iCloud/Voice Memos and is not a sparse/placeholder stub.
 * Uses sync reads for simplicity and reliability under chokidar.
 * Throws a ValidationError('fileIntegrity') on final failure to trigger retries.
 *
 * Config (optional):
 * - watch.stability.tailRead.enabled (default: true)
 * - watch.stability.tailRead.attempts (default: 5)
 * - watch.stability.tailRead.delayMs (default: 4000)
 * - watch.stability.tailRead.tailBytes (default: 65536)
 */
async function ensureReadableTail(filePath, opts = {}) {
  const enabled = getConfigValue(config, 'watch.stability.tailRead.enabled', true);
  if (!enabled) return;

  const attempts = getConfigValue(config, 'watch.stability.tailRead.attempts', opts.attempts || 5);
  const delayMs = getConfigValue(config, 'watch.stability.tailRead.delayMs', opts.delayMs || 4000);
  const tailBytes = getConfigValue(config, 'watch.stability.tailRead.tailBytes', opts.tailBytes || 65536);

  for (let i = 0; i < attempts; i++) {
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const stats = fs.fstatSync(fd);
        if (!stats || stats.size <= 0) {
          throw new Error('size=0');
        }
        const readSize = Math.min(tailBytes, stats.size);
        const buffer = Buffer.allocUnsafe(readSize);
        const offset = Math.max(0, stats.size - readSize);
        const bytesRead = fs.readSync(fd, buffer, 0, readSize, offset);
        if (bytesRead < readSize) {
          throw new Error(`short-read ${bytesRead}/${readSize}`);
        }
        // Success
        if (i > 0) {
          logger.info(LogCategory.WATCH, `Tail-read OK after ${i + 1} attempt(s): ${path.basename(filePath)}`);
        } else {
          logger.debug ? logger.debug(LogCategory.WATCH, 'Tail-read OK (first try)') : null;
        }
        return;
      } finally {
        try { fs.closeSync(fd); } catch {}
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const isLast = i === attempts - 1;
      if (!isLast) {
        logger.info(
          LogCategory.WATCH,
          `Tail-read waiting for ${path.basename(filePath)} (${msg}). Retry ${i + 1}/${attempts} in ${Math.round(delayMs/1000)}s`
        );
        await new Promise(res => setTimeout(res, delayMs));
        continue;
      }

      const vErr = new ValidationError(
        `File tail not readable or still syncing (${msg})`,
        'fileIntegrity'
      );
      // Make it match retry filter explicitly
      vErr.code = 'fileIntegrity';
      throw vErr;
    }
  }
}

/**
 * macOS-only: Use Spotlight (mdls) to verify an iCloud-backed file is fully local.
 * Returns when:
 *  - File is not ubiquitous (not managed by iCloud) OR
 *  - Download status is "Current" OR
 *  - PercentDownloaded >= 100 AND PhysicalSize ~= LogicalSize OR
 *  - kMDItemDownloadedDate is present
 * On repeated failure, throws ValidationError('fileIntegrity') to trigger queue retries.
 *
 * Config (optional):
 * - watch.stability.mdlsCheck.enabled (default: true on macOS)
 * - watch.stability.mdlsCheck.attempts (default: 5)
 * - watch.stability.mdlsCheck.delayMs (default: 3000)
 */
async function ensureMdlsReady(filePath, opts = {}) {
  if (process.platform !== 'darwin') return; // Only applicable to macOS
  const enabled = getConfigValue(config, 'watch.stability.mdlsCheck.enabled', true);
  if (!enabled) return;

  const attempts = getConfigValue(config, 'watch.stability.mdlsCheck.attempts', opts.attempts || 5);
  const delayMs = getConfigValue(config, 'watch.stability.mdlsCheck.delayMs', opts.delayMs || 3000);

  const mdlsArgs = [
    '-name','kMDItemIsUbiquitous',
    '-name','kMDItemUbiquitousItemDownloadingStatus',
    '-name','kMDItemUbiquitousItemPercentDownloaded',
    '-name','kMDItemPhysicalSize',
    '-name','kMDItemLogicalSize',
    '-name','kMDItemDownloadedDate',
    filePath
  ];

  const parseLine = (line) => {
    const idx = line.indexOf('=');
    if (idx === -1) return [null, null];
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val === '(null)') return [key, null];
    if (/^".*"$/.test(val)) val = val.slice(1, -1);
    if (/^[0-9]+(\.[0-9]+)?$/.test(val)) val = Number(val);
    if (val === '1') val = 1; if (val === '0') val = 0;
    return [key, val];
  };

  const getStatusText = (vals) => {
    const s = (vals.kMDItemUbiquitousItemDownloadingStatus || '').toString();
    return s;
  };

  for (let i = 0; i < attempts; i++) {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('mdls', mdlsArgs);
      const vals = {};
      stdout.split(/\r?\n/).forEach(line => {
        if (!line) return;
        const [k, v] = parseLine(line);
        if (k) vals[k] = v;
      });

      const ubiquitous = vals.kMDItemIsUbiquitous === 1 || vals.kMDItemIsUbiquitous === true;
      if (!ubiquitous) {
        // Not an iCloud-managed file, nothing to wait for
        return;
      }

      const status = (vals.kMDItemUbiquitousItemDownloadingStatus || '').toString().toLowerCase();
      const percent = Number(vals.kMDItemUbiquitousItemPercentDownloaded ?? NaN);
      const phys = Number(vals.kMDItemPhysicalSize ?? NaN);
      const logical = Number(vals.kMDItemLogicalSize ?? NaN);
      const hasDownloadedDate = !!vals.kMDItemDownloadedDate;

      const sizeLooksComplete = Number.isFinite(phys) && Number.isFinite(logical) && phys >= logical && logical > 0;

      // Pass conditions
      if (status === 'current' || hasDownloadedDate || (Number.isFinite(percent) && percent >= 100 && sizeLooksComplete)) {
        if (i > 0) {
          logger.info(LogCategory.WATCH, `mdls OK after ${i + 1} attempt(s): ${path.basename(filePath)} (status=${status || 'n/a'})`);
        }
        return;
      }

      // Not ready yet
      const display = `status=${status || 'n/a'}, percent=${Number.isFinite(percent) ? percent : 'n/a'}, phys=${Number.isFinite(phys)?phys:'n/a'}, logical=${Number.isFinite(logical)?logical:'n/a'}`;
      const isLast = i === attempts - 1;
      if (!isLast) {
        logger.info(LogCategory.WATCH, `iCloud syncing: ${display}. Retry ${i + 1}/${attempts} in ${Math.round(delayMs/1000)}s`);
        await new Promise(res => setTimeout(res, delayMs));
        continue;
      }

      const vErr = new ValidationError(`iCloud metadata indicates file not ready (${display})`, 'fileIntegrity');
      vErr.code = 'fileIntegrity';
      throw vErr;
    } catch (err) {
      // If mdls isn't available or fails unexpectedly, fall back to tail-read without blocking
      const msg = err && err.message ? err.message : String(err);
      // Only escalate on our own ValidationError; otherwise, break and continue pipeline
      if (err instanceof ValidationError || (err && err.code === 'fileIntegrity')) {
        throw err;
      }
      logger.warn(LogCategory.WATCH, `mdls check skipped (${msg})`);
      return;
    }
  }
}

/**
 * Move compressed file to processed directory and delete original
 * @param {string} originalPath - Original file path
 * @param {string} compressedPath - Compressed file path
 * @param {string} generatedName - Generated filename from processing
 * @param {string} tempDir - Temporary directory to clean up
 * @param {string} processedDir - Directory to move processed files to
 */
async function moveToProcessed(originalPath, compressedPath, generatedName, tempDir, processedDir, meta = {}) {
  try {
    // Validate inputs
    if (!compressedPath || !fs.existsSync(compressedPath)) {
      throw new Error(`Compressed file not found: ${compressedPath}`);
    }

    if (!processedDir) {
      throw new Error('Processed directory path is required');
    }

    // Ensure processed directory exists
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
      console.log(`Created processed directory: ${processedDir}`);
    }

    // Determine appropriate file extension
    // If compressed path is same as original, no compression occurred - preserve extension
    let newFilename;
    if (compressedPath === originalPath) {
      const originalExt = path.extname(originalPath);
      newFilename = generatedName + originalExt;
      console.log(`No compression detected, preserving original extension: ${originalExt}`);
    } else {
      // Actual compression occurred, use .m4a
      newFilename = generatedName + '.m4a';
      console.log(`Compression detected, using .m4a extension`);
    }
    const newPath = path.join(processedDir, newFilename);

    // Check if destination already exists
    if (fs.existsSync(newPath)) {
      console.warn(`Destination file already exists, will overwrite: ${newPath}`);
    }
    
    // Get file sizes for logging
    let originalStats, compressedStats, originalSizeMB, compressedSizeMB, compressionRatio;

    try {
      compressedStats = fs.statSync(compressedPath);
      compressedSizeMB = (compressedStats.size / (1024 * 1024)).toFixed(2);

      if (fs.existsSync(originalPath)) {
        originalStats = fs.statSync(originalPath);
        originalSizeMB = (originalStats.size / (1024 * 1024)).toFixed(2);
        compressionRatio = (originalStats.size / compressedStats.size).toFixed(1);
      } else {
        originalSizeMB = 'N/A';
        compressionRatio = 'N/A';
      }
    } catch (error) {
      console.warn(`Warning: Could not get file stats: ${error.message}`);
      originalSizeMB = 'N/A';
      compressedSizeMB = 'N/A';
      compressionRatio = 'N/A';
    }
    
    console.log(`Moving compressed file to processed directory:`);
    console.log(`  Original: ${path.basename(originalPath)} (${originalSizeMB} MB)`);
    console.log(`  Compressed: ${path.basename(compressedPath)} (${compressedSizeMB} MB)`);
    console.log(`  Compression ratio: ${compressionRatio}x smaller`);
    console.log(`  Destination: ${newFilename}`);
    
    // Move the compressed file
    try {
      fs.renameSync(compressedPath, newPath);
      console.log(`✓ Compressed file moved to: ${newPath}`);
    } catch (moveError) {
      // If rename fails (e.g., cross-device), try copy then delete
      console.warn(`Rename failed (${moveError.message}), trying copy and delete...`);
      fs.copyFileSync(compressedPath, newPath);
      fs.unlinkSync(compressedPath);
      console.log(`✓ Compressed file copied and original deleted: ${newPath}`);
    }
    
    // Delete the original large file if it exists and is different from compressed file
    if (originalPath !== compressedPath && fs.existsSync(originalPath)) {
      fs.unlinkSync(originalPath);
      console.log(`✓ Original file deleted: ${path.basename(originalPath)}`);
    } else if (!fs.existsSync(originalPath)) {
      console.log(`ℹ️ Original file already moved or deleted: ${path.basename(originalPath)}`);
    }
    
    // Clean up the temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`✓ Temp directory cleaned up`);
    }
    
    if (originalStats && compressedStats) {
      console.log(`✓ Successfully processed: saved ${((originalStats.size - compressedStats.size) / (1024 * 1024)).toFixed(2)} MB`);
    } else {
      console.log(`✓ Successfully processed and moved to: ${newPath}`);
    }
    try {
      // Append NDJSON record including destination path
      appendRecord(config, {
        processedAt: new Date().toISOString(),
        sourcePath: path.isAbsolute(originalPath) ? originalPath : path.resolve(originalPath),
        sourceName: path.basename(originalPath),
        destAudioPath: newPath,
        outputMdPath: meta.outputMdPath || null,
        service: meta.service || null,
        model: meta.model || null,
        sizeSourceBytes: originalStats ? originalStats.size : null,
        sizeDestBytes: compressedStats ? compressedStats.size : null
      });
    } catch {}
    return newPath;
  } catch (err) {
    console.error(`Error moving file to processed: ${err.message}`);
    throw err;
  }
}

/**
 * Schedule a retry for a failed file
 * @param {string} filePath - Path to the file to retry
 * @param {Error} error - The error that caused the failure
 */
function scheduleRetry(filePath, error) {
  const maxAttempts = getConfigValue(config, 'watch.validation.retries.maxAttempts', 3);
  const retryDelays = getConfigValue(config, 'watch.validation.retries.delays', [5000, 15000, 30000]);

  const currentAttempt = retryCount.get(filePath) || 0;
  const nextAttempt = currentAttempt + 1;

  if (nextAttempt >= maxAttempts) {
    logger.failure(LogCategory.QUEUE,
      `File ${path.basename(filePath)} failed after ${maxAttempts} attempts, giving up: ${error.message}`
    );

    // Persist failure to history
    appendFailureRecord(config, {
      sourcePath: filePath,
      attemptNumber: maxAttempts,
      error: {
        type: error.name || 'Error',
        message: error.message || 'Unknown error',
        code: error.code || null,
        service: null // Will be populated if available from error context
      }
    });

    retryCount.delete(filePath);
    return;
  }

  const delay = retryDelays[nextAttempt - 1] || retryDelays[retryDelays.length - 1] || 30000;
  retryCount.set(filePath, nextAttempt);

  // Check if error is retryable
  const isRetryable = error.name === 'ValidationError' &&
    (error.code === 'fileIntegrity' ||
     error.message.includes('moov atom') ||
     error.message.includes('corrupted') ||
     error.message.includes('incomplete'));

  if (!isRetryable) {
    logger.failure(LogCategory.QUEUE,
      `File ${path.basename(filePath)} failed with non-retryable error: ${error.message}`
    );

    // Persist failure to history
    appendFailureRecord(config, {
      sourcePath: filePath,
      attemptNumber: nextAttempt,
      error: {
        type: error.name || 'Error',
        message: error.message || 'Unknown error',
        code: error.code || null,
        service: null
      }
    });

    retryCount.delete(filePath);
    return;
  }

  logger.info(LogCategory.QUEUE,
    `Scheduling retry ${nextAttempt}/${maxAttempts} for ${path.basename(filePath)} in ${delay/1000}s`
  );

  const timeoutId = setTimeout(() => {
    retryTimeouts.delete(filePath);
    processingQueue.push(filePath);
    processQueue();
  }, delay);

  retryTimeouts.set(filePath, timeoutId);
}

/**
 * Process files from the queue sequentially
 */
async function processQueue() {
  if (isProcessingQueue || processingQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  
  while (processingQueue.length > 0) {
    const filePath = processingQueue.shift();
    const remainingCount = processingQueue.length;
    
    const currentAttempt = retryCount.get(filePath) || 0;
    const attemptText = currentAttempt > 0 ? ` (attempt ${currentAttempt + 1})` : '';
    
    logger.queueStatus(`Processing ${path.basename(filePath)}${attemptText} (${remainingCount} remaining in queue)`);

    try {
      // Process the file
      await processFile(filePath);
      
      // Success - clear any retry tracking
      if (retryCount.has(filePath)) {
        logger.success(LogCategory.QUEUE, `File ${path.basename(filePath)} processed successfully after ${currentAttempt + 1} attempts`);
        retryCount.delete(filePath);
      }

      // Configured delay between files
      if (processingQueue.length > 0) {
        const delay = getConfigValue(config, 'watch.queue.delayBetweenFiles', 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      logger.failure(LogCategory.QUEUE, `Error processing ${path.basename(filePath)}: ${error.message}`);
      scheduleRetry(filePath, error);
    }
  }
  
  isProcessingQueue = false;
}

/**
 * Add a file to the processing queue
 * @param {string} filePath - Path to the file to queue
 */
function addToQueue(filePath) {
  // Check if file is supported
  if (!isSupportedFile(filePath)) {
    return;
  }
  
  // Check if file is already in queue or being processed
  if (processingQueue.includes(filePath) || processed.has(filePath)) {
    logger.info(LogCategory.QUEUE, `File already queued or processed: ${path.basename(filePath)}`);
    return;
  }

  const source = getFileSource(filePath);
  const queuePosition = processingQueue.length + 1;
  logger.info(LogCategory.WATCH, `New file detected from ${source}: ${path.basename(filePath)}`);
  logger.queueStatus(`Adding to queue (position ${queuePosition})`);
  
  processingQueue.push(filePath);
  
  // Start processing if not already running
  processQueue();
}

/**
 * Parse date range string into start and end dates
 * @param {string|null} dateRangeValue - Date range in format "MM-DD-YY" or "MM-DD-YY:MM-DD-YY"
 * @returns {Object} - {startDate, endDate} Date objects
 */
function parseDateRange(dateRangeValue) {
  const currentDate = new Date();
  
  // If no date range provided, use configured default
  if (!dateRangeValue) {
    const defaultDays = getConfigValue(config, 'watch.initialProcessing.defaultDateRange', 120);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - defaultDays);
    return { startDate, endDate: currentDate };
  }
  
  /**
   * Parse a date string in MM-DD-YY format
   * @param {string} dateStr - Date string like "7-23-25"
   * @returns {Date} - Parsed Date object
   */
  function parseDate(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
      throw new Error(`Invalid date format: ${dateStr}. Expected MM-DD-YY format.`);
    }
    
    const [month, day, year] = parts.map(p => parseInt(p, 10));
    
    if (isNaN(month) || isNaN(day) || isNaN(year)) {
      throw new Error(`Invalid date format: ${dateStr}. All parts must be numbers.`);
    }
    
    if (month < 1 || month > 12) {
      throw new Error(`Invalid month: ${month}. Must be 1-12.`);
    }
    
    if (day < 1 || day > 31) {
      throw new Error(`Invalid day: ${day}. Must be 1-31.`);
    }
    
    // Convert 2-digit year to full year (assume 20XX for years 00-99)
    const fullYear = year < 100 ? 2000 + year : year;
    
    const date = new Date(fullYear, month - 1, day); // month is 0-indexed in Date constructor
    
    // Validate the date actually exists (handles invalid dates like Feb 30)
    if (date.getMonth() !== month - 1 || date.getDate() !== day || date.getFullYear() !== fullYear) {
      throw new Error(`Invalid date: ${dateStr} does not represent a valid calendar date.`);
    }
    
    return date;
  }
  
  try {
    // Check if it's a date range (contains ':')
    if (dateRangeValue.includes(':')) {
      const [startStr, endStr] = dateRangeValue.split(':');
      if (!startStr || !endStr) {
        throw new Error(`Invalid date range format: ${dateRangeValue}. Expected MM-DD-YY:MM-DD-YY format.`);
      }
      
      const startDate = parseDate(startStr);
      const endDate = parseDate(endStr);
      
      if (startDate > endDate) {
        throw new Error(`Invalid date range: start date (${startStr}) is after end date (${endStr}).`);
      }
      
      return { startDate, endDate };
    } else {
      // Single date - from that date to current date
      const startDate = parseDate(dateRangeValue);
      
      if (startDate > currentDate) {
        throw new Error(`Start date (${dateRangeValue}) cannot be in the future.`);
      }
      
      return { startDate, endDate: currentDate };
    }
  } catch (error) {
    console.error(`\nError parsing date range: ${error.message}`);
    console.error(`\nSupported formats:`);
    console.error(`  MM-DD-YY          (from date to current date)`);
    console.error(`  MM-DD-YY:MM-DD-YY (specific date range)`);
    console.error(`\nExamples:`);
    console.error(`  7-23-25           (July 23, 2025 to now)`);
    console.error(`  4-1-25:5-31-25    (April 1, 2025 to May 31, 2025)`);
    process.exit(1);
  }
}

// History is loaded via NDJSON (see src/processHistory.mjs)

/**
 * Process unprocessed Voice Memos from a specified date range
 */
async function processRecentVoiceMemos(startDate, endDate, dryRun = false) {
  const startDateStr = startDate.toLocaleDateString();
  const endDateStr = endDate.toLocaleDateString();
  
  console.log(`\n[${dryRun ? 'Dry Run' : 'Process Recent VM'}] Scanning Voice Memos from ${startDateStr} to ${endDateStr}...`);
  
  try {
    // Find Voice Memos directory config
    const voiceMemoConfig = directoryConfigs.find(config => 
      config.name === 'Voice Memos' || config.name.toLowerCase().includes('voice memo'));
    
    if (!voiceMemoConfig) {
      logger.warn(LogCategory.CONFIG, 'Voice Memos directory not configured in directories.watch');
      return;
    }

    // Check if Voice Memos directory exists
    if (!fs.existsSync(voiceMemoConfig.watchPath)) {
      logger.failure(LogCategory.CONFIG, `Voice Memos directory not found: ${voiceMemoConfig.watchPath}`);
      return;
    }
    
    // Get all files in the directory
    const files = fs.readdirSync(voiceMemoConfig.watchPath);
    const allVoiceMemoFiles = files
      .filter(file => isSupportedFile(file) && !file.endsWith('.processing'))
      .map(file => path.join(voiceMemoConfig.watchPath, file))
      .map(filePath => {
        const stats = fs.statSync(filePath);
        return {
          path: filePath,
          name: path.basename(filePath),
          stats: stats,
          modTime: stats.mtime
        };
      })
      .filter(item => item.modTime >= startDate && item.modTime <= endDate) // Filter by date range
      .sort((a, b) => a.modTime - b.modTime); // Sort by modification time, oldest first
    
    if (allVoiceMemoFiles.length === 0) {
      logger.info(LogCategory.PROCESSING, `No Voice Memo files found from ${startDateStr} to ${endDateStr}`);
      return;
    }
    
    // Get processed filenames from history (original basenames)
    const { bySourceName: processedFilenames } = loadIndex(config);
    
    // Separate processed and unprocessed files
    const processedFiles = [];
    const unprocessedFiles = [];
    
    allVoiceMemoFiles.forEach(item => {
      if (processedFilenames.has(item.name)) {
        processedFiles.push(item);
      } else {
        unprocessedFiles.push(item);
      }
    });
    
    // Display results
    logger.section(`Voice Memo Scan Results: ${startDateStr} to ${endDateStr}`);
    logger.info(LogCategory.PROCESSING, `Found ${allVoiceMemoFiles.length} Voice Memo file(s)`);

    if (processedFiles.length > 0) {
      logger.subsection(`Already Processed (${processedFiles.length})`);
      processedFiles.forEach(item => {
        const modTime = item.modTime.toLocaleString();
        const sizeMB = (item.stats.size / (1024 * 1024)).toFixed(2);
        logger.fileStatus(item.name, LogStatus.SUCCESS, `${sizeMB} MB, modified: ${modTime}`);
      });
    }
    
    if (unprocessedFiles.length > 0) {
      logger.subsection(`To Be Processed (${unprocessedFiles.length})`);
      let totalSize = 0;
      unprocessedFiles.forEach(item => {
        const modTime = item.modTime.toLocaleString();
        const sizeMB = (item.stats.size / (1024 * 1024)).toFixed(2);
        totalSize += item.stats.size;
        logger.fileStatus(item.name, LogStatus.ARROW, `${sizeMB} MB, modified: ${modTime}`);
      });

      const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      logger.info(LogCategory.PROCESSING, `Total size to process: ${totalSizeMB} MB`);
      
      if (dryRun) {
        console.log('\n[Dry Run] This was a preview. Use without --dry-run to actually process these files.');
      } else {
        console.log(`\nProcessing ${unprocessedFiles.length} unprocessed files...\n`);
        
        // Process files sequentially
        for (let i = 0; i < unprocessedFiles.length; i++) {
          const item = unprocessedFiles[i];
          console.log(`\n[${i + 1}/${unprocessedFiles.length}] Processing: ${item.name}`);
          
          await processFile(item.path);
          
          // Configured delay between files
          if (i < unprocessedFiles.length - 1) {
            const delay = getConfigValue(config, 'watch.queue.delayBetweenFiles', 2000);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
        console.log('\n[Process Recent VM] Finished processing Voice Memos.\n');
      }
    } else {
      logger.info(LogCategory.PROCESSING, `All Voice Memos from ${startDateStr} to ${endDateStr} have already been processed.`);
    }

    logger.subsection('Summary');
    logger.info(LogCategory.PROCESSING, `Total Voice Memos from ${startDateStr} to ${endDateStr}: ${allVoiceMemoFiles.length}`);
    logger.info(LogCategory.PROCESSING, `Already processed: ${processedFiles.length}`);
    logger.info(LogCategory.PROCESSING, `To be processed: ${unprocessedFiles.length}`);

  } catch (err) {
    logger.failure(LogCategory.PROCESSING, `Error during Voice Memos scan: ${err.message}`);
  }
}

/**
 * Process all existing files in the Google Drive unprocessed directory
 */
async function cleanoutUnprocessed() {
  logger.section('Cleanout Mode - Processing Existing Files');
  
  try {
    // Find Google Drive unprocessed directory config
    const googleDriveConfig = directoryConfigs.find(config => 
      config.name === 'Google Drive Unprocessed' || 
      (config.name.toLowerCase().includes('google') && config.name.toLowerCase().includes('drive')));
    
    if (!googleDriveConfig) {
      logger.warn(LogCategory.CONFIG, 'Google Drive unprocessed directory not configured in directories.watch');
      return;
    }

    // Check if directory exists
    if (!fs.existsSync(googleDriveConfig.watchPath)) {
      logger.failure(LogCategory.CONFIG, `Google Drive unprocessed directory not found: ${googleDriveConfig.watchPath}`);
      return;
    }
    
    // Get all files in the directory
    const files = fs.readdirSync(googleDriveConfig.watchPath);
    const supportedFiles = files
      .filter(file => isSupportedFile(file) && !file.endsWith('.processing'))
      .map(file => path.join(googleDriveConfig.watchPath, file))
      .map(filePath => ({
        path: filePath,
        stats: fs.statSync(filePath)
      }))
      .sort((a, b) => b.stats.mtime - a.stats.mtime) // Sort by modification time, newest first
      .map(item => item.path);
    
    if (supportedFiles.length === 0) {
      console.log('No supported files found in unprocessed directory.');
      return;
    }
    
    logger.info(LogCategory.PROCESSING, `Found ${supportedFiles.length} file(s) to process (sorted by most recent first):`);
    supportedFiles.forEach(file => {
      const stats = fs.statSync(file);
      const modTime = stats.mtime.toLocaleString();
      logger.fileStatus(path.basename(file), LogStatus.ARROW, `modified: ${modTime}`);
    });
    console.log('');
    
    // Process files sequentially to avoid overwhelming the system
    for (let i = 0; i < supportedFiles.length; i++) {
      const filePath = supportedFiles[i];
      console.log(`\n[${i + 1}/${supportedFiles.length}] Processing: ${path.basename(filePath)}`);
      
      // Use the existing processFile function which handles all the logic
      await processFile(filePath);
      
      // Configured delay between files
      if (i < supportedFiles.length - 1) {
        const delay = getConfigValue(config, 'watch.queue.delayBetweenFiles', 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    console.log('\n[Cleanout Mode] Finished processing existing files.\n');
  } catch (err) {
    console.error('Error during cleanout:', err.message);
  }
}

/**
 * Process a new file using directory-specific configuration
 * @param {string} filePath - Path to the file to process
 */
async function processFile(filePath) {
  if (!isSupportedFile(filePath) || processed.has(filePath)) {
    return;
  }
  
  // Check if lock file exists (file is being processed)
  const lockPath = `${filePath}.processing`;
  if (fs.existsSync(lockPath)) {
    console.log(`File is already being processed: ${filePath}`);
    return;
  }
  
  const dirConfig = getFileDirectoryConfig(filePath, directoryConfigs);
  if (!dirConfig) {
    console.error(`File ${filePath} doesn't match any watched directory`);
    return;
  }
  
  console.log(`Processing from ${dirConfig.name}: ${path.basename(filePath)}`);
  
  // Wait for configured delay to ensure file is fully written
  const initialDelay = getConfigValue(config, 'watch.queue.initialDelay', 5000);
  await new Promise(res => setTimeout(res, initialDelay));
  // Check if file still exists (might have been deleted/moved)
  if (!fs.existsSync(filePath)) {
    console.log('File no longer exists, skipping.');
    return;
  }

  // macOS Spotlight (mdls) heuristic as a first gate for iCloud readiness
  await ensureMdlsReady(filePath);

  // Tail-read hydration/verification as second gate
  await ensureReadableTail(filePath);

  // Check if file still exists (might have been deleted/moved)
  if (!fs.existsSync(filePath)) {
    console.log('File no longer exists, skipping.');
    return;
  }
  
  // Mark as processed to avoid duplicates
  processed.add(filePath);
  
  // Create lock file
  const lock = createLockFile(filePath);
  
  try {
    console.log('Processing file with directory-specific options...');
    
    // Merge directory-specific options with defaults
    const processingOptions = {
      silentMode: getConfigValue(config, 'modes.silent.enabled', true),
      transcriptionService: dirConfig.processingOptions.transcriptionService ||
                            getConfigValue(config, 'transcription.defaultService', 'scribe'),
      model: dirConfig.processingOptions.model ||
             (dirConfig.processingOptions.transcriptionService === 'scribe' ?
              getConfigValue(config, 'transcription.scribe.model', 'scribe_v1') :
              getConfigValue(config, 'transcription.whisper.model', 'whisper-1')),
      maxSpeakers: dirConfig.processingOptions.maxSpeakers ||
                   getConfigValue(config, 'transcription.scribe.maxSpeakers', null),
      outputPath: dirConfig.outputPath,
      compress: dirConfig.processingOptions.compress !== false,
      bitrate: dirConfig.processingOptions.bitrate ||
               getConfigValue(config, 'audio.compression.normal.bitrate', '48k'),
      diarize: dirConfig.processingOptions.diarize !== false,
      fromGoogleDrive: dirConfig.name.toLowerCase().includes('google drive')
    };
    
    const result = await processVoiceMemo(filePath, processingOptions);
    
    console.log('✓ Processing completed successfully');
    
    // Handle post-processing based on directory config
    if (dirConfig.moveAfterProcessing && result && result.finalName) {
      if (result.compressedPath) {
        // Move compressed file and delete original
        await moveToProcessed(
          filePath,
          result.compressedPath,
          result.finalName,
          result.tempDir,
          dirConfig.processedPath,
          { service: processingOptions.transcriptionService, model: processingOptions.model, outputMdPath: result.mdFilePath }
        );
      } else {
        // Fallback to old behavior if no compressed path
        console.warn('No compressed path returned, falling back to moving original file');
        await moveToProcessed(
          filePath,
          filePath,
          result.finalName,
          null,
          dirConfig.processedPath,
          { service: processingOptions.transcriptionService, model: processingOptions.model, outputMdPath: result.mdFilePath }
        );
      }
    }
    
  } catch (err) {
    logger.failure(LogCategory.PROCESSING, `Error processing file: ${err.message}`);
    // Remove from processed set so it can be retried
    processed.delete(filePath);
    // Re-throw so processQueue() can handle retry logic
    throw err;
  } finally {
    // Always remove lock file
    removeLockFile(lock);
  }
}

/**
 * Validate directories and prepare watching list with interactive prompting
 */
async function validateDirectories() {
  directoryConfigs = loadDirectoryConfigs();
  const validConfigs = [];
  
  logger.section('Validating Configured Directories');
  
  for (const dirConfig of directoryConfigs) {
    if (!dirConfig.enabled) {
      logger.info(LogCategory.CONFIG, `⏭️  Skipping disabled: ${dirConfig.name}`);
      continue;
    }
    
    const exists = fs.existsSync(dirConfig.watchPath);
    
    if (!exists) {
      logger.warn(LogCategory.CONFIG, `${dirConfig.name} directory not found:`);
      logger.warn(LogCategory.CONFIG, `Path: ${dirConfig.watchPath}`);
      
      const answer = await askUser(`\nHow would you like to proceed?\n` +
        `  [1] Skip this directory\n` +
        `  [2] Use current directory\n` +
        `  [3] Create the directory\n` +
        `  [4] Exit to fix configuration\n` +
        `Choice (1-4): `);
      
      switch(answer) {
        case '1':
          logger.info(LogCategory.CONFIG, `→ Skipping ${dirConfig.name}`);
          continue;

        case '2':
          dirConfig.watchPath = process.cwd();
          if (dirConfig.moveAfterProcessing && !dirConfig.processedPath) {
            dirConfig.processedPath = path.join(process.cwd(), 'processed');
          }
          if (!dirConfig.outputPath || dirConfig.outputPath === './output') {
            dirConfig.outputPath = process.cwd();
          }
          logger.info(LogCategory.CONFIG, `→ Using current directory for ${dirConfig.name}`);
          break;

        case '3':
          fs.mkdirSync(dirConfig.watchPath, { recursive: true });
          logger.success(LogCategory.CONFIG, `Created directory: ${dirConfig.watchPath}`);
          break;

        case '4':
        default:
          logger.info(LogCategory.CONFIG, 'Please update your config.yaml and try again');
          process.exit(0);
      }
    }
    
    // Validate processed directory if needed
    if (dirConfig.moveAfterProcessing && dirConfig.processedPath && !fs.existsSync(dirConfig.processedPath)) {
      logger.info(LogCategory.CONFIG, `Creating processed directory for ${dirConfig.name}...`);
      fs.mkdirSync(dirConfig.processedPath, { recursive: true });
      logger.success(LogCategory.CONFIG, `Created: ${dirConfig.processedPath}`);
    }

    // Validate output directory
    if (dirConfig.outputPath && !fs.existsSync(dirConfig.outputPath)) {
      logger.info(LogCategory.CONFIG, `Creating output directory for ${dirConfig.name}...`);
      fs.mkdirSync(dirConfig.outputPath, { recursive: true });
      logger.success(LogCategory.CONFIG, `Created: ${dirConfig.outputPath}`);
    }
    
    if (fs.existsSync(dirConfig.watchPath)) {
      validConfigs.push(dirConfig);
      logger.validationResult(`Watching ${dirConfig.name}`, true, dirConfig.watchPath);
    }
  }
  
  if (validConfigs.length === 0) {
    logger.failure(LogCategory.SYSTEM, 'No directories are being watched');
    logger.error(LogCategory.SYSTEM, 'All configured directories were either skipped or not found');
    logger.raw('\nTo fix this:');
    logger.raw('  1. Check your config.yaml file');
    logger.raw('  2. Ensure at least one directory path is correct');
    logger.raw('  3. Run with --help for more information');
    process.exit(1);
  }

  logger.success(LogCategory.WATCH, `Watching ${validConfigs.length} director${validConfigs.length === 1 ? 'y' : 'ies'}`);
  
  // Update global directory configs with validated ones
  directoryConfigs = validConfigs;
  
  // Return paths for chokidar
  return validConfigs.map(config => config.watchPath);
}

// Run special modes if requested
async function startWatching() {
  // Clean up orphaned lock files from previous runs
  cleanupOrphanedLocks();

  // Recover previously failed files and add them to the queue
  recoverFailedFiles();

  // Validate directories and get list to watch
  const dirsToWatch = await validateDirectories();
  
  // Check config for initial processing modes
  const configCleanout = getConfigValue(config, 'watch.initialProcessing.cleanout', false);
  const configProcessRecent = getConfigValue(config, 'watch.initialProcessing.processRecentVm', false);
  
  if (cleanoutMode || configCleanout) {
    await cleanoutUnprocessed();
  }
  
  if (processRecentVmMode || configProcessRecent) {
    // Parse the date range
    const { startDate, endDate } = parseDateRange(dateRangeValue);
    
    await processRecentVoiceMemos(startDate, endDate, dryRunMode);
    if (dryRunMode) {
      // Exit after dry run, don't start watching
      process.exit(0);
    }
  }
  
  // Start watching
  logger.section('File Watching Active');
  logger.info(LogCategory.WATCH, 'Watching for new audio/video files...');
  logger.info(LogCategory.WATCH, `Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  logger.info(LogCategory.SYSTEM, 'Press Ctrl+C to stop');

  // Get watch configuration
  const stabilityThreshold = getConfigValue(config, 'watch.stability.threshold', 2000);
  const pollInterval = getConfigValue(config, 'watch.stability.pollInterval', 100);
  const ignorePatterns = getConfigValue(config, 'fileProcessing.ignore.patterns', []);
  const ignoreDirs = getConfigValue(config, 'fileProcessing.ignore.directories', []);
  
  // Ensure arrays are valid
  const safeIgnorePatterns = Array.isArray(ignorePatterns) ? ignorePatterns : [];
  const safeIgnoreDirs = Array.isArray(ignoreDirs) ? ignoreDirs : [];
  
  // Build ignore patterns for chokidar
  const chokidarIgnored = [
    ...safeIgnorePatterns.map(p => `**/${p}`),
    ...safeIgnoreDirs.map(d => `**${d}/**`),
    ...safeIgnoreDirs.map(d => `**${d}`)
  ];
  
  const watcher = chokidar.watch(dirsToWatch, { 
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold,
      pollInterval
    },
    ignored: chokidarIgnored
  });

  watcher
    .on('add', addToQueue)
    .on('error', error => logger.failure(LogCategory.WATCH, `Watcher error: ${error.message}`));

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info(LogCategory.SYSTEM, 'Stopping file watcher...');
    watcher.close();
    process.exit(0);
  });
}

// Display version info on startup
const versionInfo = getVersionInfo();
const cleanVersion = versionInfo.version.replace(/"/g, '');
logger.info(LogCategory.SYSTEM, `summarai v${cleanVersion} starting...`);
if (versionInfo.buildDate !== 'development') {
  const cleanBuildTime = versionInfo.buildTime.replace(/"/g, '');
  const timeOnly = cleanBuildTime.includes('T') ? cleanBuildTime.split('T')[1]?.split('.')[0] : '';
  logger.debug(LogCategory.SYSTEM, `Build: ${versionInfo.buildDate.replace(/"/g, '')} ${timeOnly}`);
}

// Start the application
startWatching();
