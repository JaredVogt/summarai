#!/usr/bin/env node

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { processVoiceMemo } from './transcribe.mjs';
import { cleanupTempDir } from './audioProcessing.mjs';
import { loadConfig, getConfigValue } from './configLoader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
let config;
try {
  config = loadConfig();
  console.log('✓ Configuration loaded successfully');
} catch (error) {
  console.error('Error loading configuration:', error.message);
  console.error('Please ensure config.yaml exists and is valid.');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const cleanoutMode = args.includes('--cleanout');
const dryRunMode = args.includes('--dry-run');
const showHelp = args.includes('--help') || args.includes('-h');

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

// Directory configurations from config
const VOICE_MEMOS_DIR = getConfigValue(config, 'directories.voiceMemos');
const GOOGLE_DRIVE_UNPROCESSED = getConfigValue(config, 'directories.googleDrive.unprocessed');
const GOOGLE_DRIVE_PROCESSED = getConfigValue(config, 'directories.googleDrive.processed');

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
 * @returns {string} - 'voiceMemos' or 'googleDrive'
 */
function getFileSource(filePath) {
  if (filePath.startsWith(VOICE_MEMOS_DIR)) {
    return 'voiceMemos';
  } else if (filePath.startsWith(GOOGLE_DRIVE_UNPROCESSED)) {
    return 'googleDrive';
  }
  return 'unknown';
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
 */
async function moveToProcessed(originalPath, compressedPath, generatedName, tempDir) {
  try {
    // Ensure processed directory exists
    if (!fs.existsSync(GOOGLE_DRIVE_PROCESSED)) {
      fs.mkdirSync(GOOGLE_DRIVE_PROCESSED, { recursive: true });
    }
    
    // Compressed files are always .m4a
    const newFilename = generatedName + '.m4a';
    const newPath = path.join(GOOGLE_DRIVE_PROCESSED, newFilename);
    
    // Get file sizes for logging
    const originalStats = fs.statSync(originalPath);
    const compressedStats = fs.statSync(compressedPath);
    const originalSizeMB = (originalStats.size / (1024 * 1024)).toFixed(2);
    const compressedSizeMB = (compressedStats.size / (1024 * 1024)).toFixed(2);
    const compressionRatio = (originalStats.size / compressedStats.size).toFixed(1);
    
    console.log(`Moving compressed file to processed directory:`);
    console.log(`  Original: ${path.basename(originalPath)} (${originalSizeMB} MB)`);
    console.log(`  Compressed: ${path.basename(compressedPath)} (${compressedSizeMB} MB)`);
    console.log(`  Compression ratio: ${compressionRatio}x smaller`);
    console.log(`  Destination: ${newFilename}`);
    
    // Move the compressed file
    fs.renameSync(compressedPath, newPath);
    console.log(`✓ Compressed file moved to: ${newPath}`);
    
    // Delete the original large file
    fs.unlinkSync(originalPath);
    console.log(`✓ Original file deleted: ${path.basename(originalPath)}`);
    
    // Clean up the temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`✓ Temp directory cleaned up`);
    }
    
    console.log(`✓ Successfully processed: saved ${((originalStats.size - compressedStats.size) / (1024 * 1024)).toFixed(2)} MB`);
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
    
    console.log(`\n[Queue] Processing ${path.basename(filePath)} (${remainingCount} remaining in queue)`);
    
    try {
      // Process the file
      await processFile(filePath);
      
      // Configured delay between files
      if (processingQueue.length > 0) {
        const delay = getConfigValue(config, 'watch.queue.delayBetweenFiles', 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(`Error processing ${filePath} from queue:`, error.message);
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
    console.log(`File already queued or processed: ${path.basename(filePath)}`);
    return;
  }
  
  const source = getFileSource(filePath);
  const queuePosition = processingQueue.length + 1;
  console.log(`\n[${new Date().toLocaleTimeString()}] New file detected from ${source}: ${path.basename(filePath)}`);
  console.log(`Adding to queue (position ${queuePosition})`);
  
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
    // Check if Voice Memos directory exists
    if (!fs.existsSync(VOICE_MEMOS_DIR)) {
      console.log('Voice Memos directory not found:', VOICE_MEMOS_DIR);
      return;
    }
    
    // Get all files in the directory
    const files = fs.readdirSync(VOICE_MEMOS_DIR);
    const allVoiceMemoFiles = files
      .filter(file => isSupportedFile(file) && !file.endsWith('.processing'))
      .map(file => path.join(VOICE_MEMOS_DIR, file))
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
      console.log(`No Voice Memo files found from ${startDateStr} to ${endDateStr}.`);
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
    console.log(`\nFound ${allVoiceMemoFiles.length} Voice Memo file(s) from ${startDateStr} to ${endDateStr}:\n`);
    
    if (processedFiles.length > 0) {
      console.log(`✓ Already processed (${processedFiles.length}):`);
      processedFiles.forEach(item => {
        const modTime = item.modTime.toLocaleString();
        const sizeMB = (item.stats.size / (1024 * 1024)).toFixed(2);
        console.log(`  ✓ ${item.name} (${sizeMB} MB, modified: ${modTime})`);
      });
      console.log('');
    }
    
    if (unprocessedFiles.length > 0) {
      console.log(`→ To be processed (${unprocessedFiles.length}):`);
      let totalSize = 0;
      unprocessedFiles.forEach(item => {
        const modTime = item.modTime.toLocaleString();
        const sizeMB = (item.stats.size / (1024 * 1024)).toFixed(2);
        totalSize += item.stats.size;
        console.log(`  → ${item.name} (${sizeMB} MB, modified: ${modTime})`);
      });
      
      const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      console.log(`\nTotal size to process: ${totalSizeMB} MB`);
      
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
      console.log(`All Voice Memos from ${startDateStr} to ${endDateStr} have already been processed.`);
    }
    
    console.log(`Summary:`);
    console.log(`- Total Voice Memos from ${startDateStr} to ${endDateStr}: ${allVoiceMemoFiles.length}`);
    console.log(`- Already processed: ${processedFiles.length}`);
    console.log(`- To be processed: ${unprocessedFiles.length}`);
    
  } catch (err) {
    console.error('Error during Voice Memos scan:', err.message);
  }
}

/**
 * Process all existing files in the Google Drive unprocessed directory
 */
async function cleanoutUnprocessed() {
  console.log('\n[Cleanout Mode] Processing existing files in unprocessed directory...');
  
  try {
    // Check if directory exists
    if (!fs.existsSync(GOOGLE_DRIVE_UNPROCESSED)) {
      console.log('Google Drive unprocessed directory not found:', GOOGLE_DRIVE_UNPROCESSED);
      return;
    }
    
    // Get all files in the directory
    const files = fs.readdirSync(GOOGLE_DRIVE_UNPROCESSED);
    const supportedFiles = files
      .filter(file => isSupportedFile(file) && !file.endsWith('.processing'))
      .map(file => path.join(GOOGLE_DRIVE_UNPROCESSED, file))
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
    
    console.log(`Found ${supportedFiles.length} file(s) to process (sorted by most recent first):`);
    supportedFiles.forEach(file => {
      const stats = fs.statSync(file);
      const modTime = stats.mtime.toLocaleString();
      console.log(`  - ${path.basename(file)} (modified: ${modTime})`);
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
 * Process a new file
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
  
  const source = getFileSource(filePath);
  console.log(`Processing: ${path.basename(filePath)}`);
  
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
    console.log('Processing file with configured options...');
    
    // Get processing options from config
    const silentMode = getConfigValue(config, 'modes.silent.enabled', true);
    const transcriptionService = getConfigValue(config, 'transcription.defaultService', 'scribe');
    const modelName = transcriptionService === 'scribe' ? 
      getConfigValue(config, 'transcription.scribe.model', 'scribe_v1') :
      getConfigValue(config, 'transcription.whisper.model', 'whisper-1');
    const maxSpeakers = getConfigValue(config, 'transcription.scribe.maxSpeakers', null);
    
    // Process with configured options
    const result = await processVoiceMemo(filePath, {
      silentMode,
      transcriptionService,
      model: modelName,
      maxSpeakers,
      fromGoogleDrive: source === 'googleDrive' // Pass flag to indicate Google Drive source
    });
    
    console.log('✓ Processing completed successfully');
    
    // If from Google Drive, move compressed file to processed folder
    if (source === 'googleDrive' && result && result.finalName) {
      if (result.compressedPath) {
        // Move compressed file and delete original
        await moveToProcessed(filePath, result.compressedPath, result.finalName, result.tempDir);
      } else {
        // Fallback to old behavior if no compressed path
        console.warn('No compressed path returned, falling back to moving original file');
        await moveToProcessed(filePath, filePath, result.finalName, null);
      }
    }
    
  } catch (err) {
    console.error('✗ Error processing file:', err.message);
    // Remove from processed set so it can be retried
    processed.delete(filePath);
  } finally {
    // Always remove lock file
    removeLockFile(lock);
  }
}

// Verify directories exist based on config
const dirsToWatch = [];

const watchVoiceMemos = getConfigValue(config, 'watch.enabled.voiceMemos', true);
const watchGoogleDrive = getConfigValue(config, 'watch.enabled.googleDrive', true);

if (watchVoiceMemos && VOICE_MEMOS_DIR) {
  if (fs.existsSync(VOICE_MEMOS_DIR)) {
    dirsToWatch.push(VOICE_MEMOS_DIR);
    console.log('✓ Watching Apple Voice Memos:', VOICE_MEMOS_DIR);
  } else {
    console.log('✗ Apple Voice Memos directory not found:', VOICE_MEMOS_DIR);
    console.log('  Update directories.voiceMemos in config.yaml if needed');
  }
}

if (watchGoogleDrive && GOOGLE_DRIVE_UNPROCESSED) {
  if (fs.existsSync(GOOGLE_DRIVE_UNPROCESSED)) {
    dirsToWatch.push(GOOGLE_DRIVE_UNPROCESSED);
    console.log('✓ Watching Google Drive unprocessed:', GOOGLE_DRIVE_UNPROCESSED);
  } else {
    console.log('✗ Google Drive unprocessed directory not found:', GOOGLE_DRIVE_UNPROCESSED);
    console.log('  Update directories.googleDrive.unprocessed in config.yaml');
  }
}

if (dirsToWatch.length === 0) {
  console.error('\nNo valid directories to watch. Exiting.');
  process.exit(1);
}

// Run special modes if requested
async function startWatching() {
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
  console.log('\nWatching for new audio/video files...');
  console.log('Supported formats:', SUPPORTED_EXTENSIONS.join(', '));
  console.log('Press Ctrl+C to stop\n');

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
    .on('error', error => console.error('Watcher error:', error));

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nStopping file watcher...');
    watcher.close();
    process.exit(0);
  });
}

// Start the application
startWatching();