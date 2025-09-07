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
Usage: node watchDirectories.mjs [options]

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
  node watchDirectories.mjs --process-recent-vm                       # Process Voice Memos from last 120 days
  node watchDirectories.mjs --process-recent-vm --dry-run             # See what would be processed (last 120 days)
  node watchDirectories.mjs --process-recent-vm 7-1-25                # Process from July 1, 2025 to now
  node watchDirectories.mjs --process-recent-vm 4-1-25:5-31-25        # Process from April 1 to May 31, 2025
  node watchDirectories.mjs --process-recent-vm 7-1-25 --dry-run      # Dry run from July 1, 2025 to now
  node watchDirectories.mjs --cleanout                                # Process Google Drive files then watch
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
import { loadConfig, getConfigValue } from './configLoader.mjs';
import logger, { LogCategory, LogStatus } from './src/logger.mjs';

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
Usage: node watchDirectories.mjs [options]

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
  node watchDirectories.mjs --process-recent-vm                       # Process Voice Memos from last 120 days
  node watchDirectories.mjs --process-recent-vm --dry-run             # See what would be processed (last 120 days)
  node watchDirectories.mjs --process-recent-vm 7-1-25                # Process from July 1, 2025 to now
  node watchDirectories.mjs --process-recent-vm 4-1-25:5-31-25        # Process from April 1 to May 31, 2025
  node watchDirectories.mjs --process-recent-vm 7-1-25 --dry-run      # Dry run from July 1, 2025 to now
  node watchDirectories.mjs --cleanout                                # Process Google Drive files then watch
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
 * Move compressed file to processed directory and delete original
 * @param {string} originalPath - Original file path
 * @param {string} compressedPath - Compressed file path
 * @param {string} generatedName - Generated filename from processing
 * @param {string} tempDir - Temporary directory to clean up
 * @param {string} processedDir - Directory to move processed files to
 */
async function moveToProcessed(originalPath, compressedPath, generatedName, tempDir, processedDir) {
  try {
    // Ensure processed directory exists
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
    }
    
    // Compressed files are always .m4a
    const newFilename = generatedName + '.m4a';
    const newPath = path.join(processedDir, newFilename);
    
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
    fs.renameSync(compressedPath, newPath);
    console.log(`✓ Compressed file moved to: ${newPath}`);
    
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
    return newPath;
  } catch (err) {
    console.error(`Error moving file to processed: ${err.message}`);
    throw err;
  }
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
    
    logger.queueStatus(`Processing ${path.basename(filePath)} (${remainingCount} remaining in queue)`);

    try {
      // Process the file
      await processFile(filePath);

      // Configured delay between files
      if (processingQueue.length > 0) {
        const delay = getConfigValue(config, 'watch.queue.delayBetweenFiles', 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      logger.failure(LogCategory.QUEUE, `Error processing ${path.basename(filePath)}: ${error.message}`);
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

/**
 * Get processed filenames from process_history.json
 */
function getProcessedFilenames() {
  const historyFile = getConfigValue(config, 'fileProcessing.history.file', './process_history.json');
  const historyPath = path.isAbsolute(historyFile) ? historyFile : path.join(__dirname, historyFile);
  if (!fs.existsSync(historyPath)) return new Set();
  try {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    if (!Array.isArray(history)) return new Set();
    return new Set(history.map(entry => entry.filename));
  } catch {
    return new Set();
  }
}

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
    
    // Get processed filenames from history
    const processedFilenames = getProcessedFilenames();
    
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
      fromDirectory: dirConfig.name
    };
    
    const result = await processVoiceMemo(filePath, processingOptions);
    
    console.log('✓ Processing completed successfully');
    
    // Handle post-processing based on directory config
    if (dirConfig.moveAfterProcessing && result && result.finalName) {
      if (result.compressedPath) {
        // Move compressed file and delete original
        await moveToProcessed(filePath, result.compressedPath, result.finalName, 
                             result.tempDir, dirConfig.processedPath);
      } else {
        // Fallback to old behavior if no compressed path
        console.warn('No compressed path returned, falling back to moving original file');
        await moveToProcessed(filePath, filePath, result.finalName, null, dirConfig.processedPath);
      }
    }
    
  } catch (err) {
    logger.failure(LogCategory.PROCESSING, `Error processing file: ${err.message}`);
    // Remove from processed set so it can be retried
    processed.delete(filePath);
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