#!/usr/bin/env node

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { processVoiceMemo } from './transcribe.mjs';
import { cleanupTempDir } from './audioProcessing.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const cleanoutMode = args.includes('--cleanout');
const showHelp = args.includes('--help') || args.includes('-h');

// Show help if requested
if (showHelp) {
  console.log(`
Usage: node watchDirectories.mjs [options]

Options:
  --cleanout    Process all existing files in Google Drive unprocessed folder before watching
  --help, -h    Show this help message

This tool watches for new audio/video files in:
- Apple Voice Memos directory
- Google Drive unprocessed directory

Files from Google Drive are moved to processed folder after successful processing.
Voice Memos files are never moved.
  `);
  process.exit(0);
}

// Directory configurations
const VOICE_MEMOS_DIR = path.join(
  process.env.HOME,
  'Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings'
);

const GOOGLE_DRIVE_UNPROCESSED = process.env.GOOGLE_DRIVE_UNPROCESSED || 
  '/Users/jaredvogt/Library/CloudStorage/GoogleDrive-jared@wolffaudio.com/My Drive/VM_transcription/unprocessed';

const GOOGLE_DRIVE_PROCESSED = process.env.GOOGLE_DRIVE_PROCESSED || 
  '/Users/jaredvogt/Library/CloudStorage/GoogleDrive-jared@wolffaudio.com/My Drive/VM_transcription/processed';

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.mp4', '.mov', '.avi', '.mkv', '.webm'];

// Track processed files to avoid duplicates
const processed = new Set();

/**
 * Check if a file has a supported extension and is not a temp file
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if supported
 */
function isSupportedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);
  const dirname = path.dirname(filePath);
  
  // Ignore temp files and files in temp directories
  if (basename.startsWith('temp') || 
      basename.startsWith('chunk_') || 
      dirname.includes('/temp/') || 
      dirname.includes('\\temp\\') ||
      dirname.endsWith('/temp') ||
      dirname.endsWith('\\temp')) {
    return false;
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
      
      // Small delay between files to be gentle on the APIs
      if (i < supportedFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
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
  console.log(`\n[${new Date().toLocaleTimeString()}] New file detected from ${source}:`, path.basename(filePath));
  
  // Wait a few seconds to ensure file is fully written
  await new Promise(res => setTimeout(res, 5000));
  
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
    console.log('Processing file with silent mode...');
    
    // Process with silent mode options
    const result = await processVoiceMemo(filePath, {
      silentMode: true,
      transcriptionService: 'scribe',
      model: 'scribe_v1',
      maxSpeakers: null,
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

// Verify directories exist
const dirsToWatch = [];

if (fs.existsSync(VOICE_MEMOS_DIR)) {
  dirsToWatch.push(VOICE_MEMOS_DIR);
  console.log('✓ Watching Apple Voice Memos:', VOICE_MEMOS_DIR);
} else {
  console.log('✗ Apple Voice Memos directory not found:', VOICE_MEMOS_DIR);
}

if (fs.existsSync(GOOGLE_DRIVE_UNPROCESSED)) {
  dirsToWatch.push(GOOGLE_DRIVE_UNPROCESSED);
  console.log('✓ Watching Google Drive unprocessed:', GOOGLE_DRIVE_UNPROCESSED);
} else {
  console.log('✗ Google Drive unprocessed directory not found:', GOOGLE_DRIVE_UNPROCESSED);
  console.log('  You can set GOOGLE_DRIVE_UNPROCESSED environment variable to specify a different path');
}

if (dirsToWatch.length === 0) {
  console.error('\nNo valid directories to watch. Exiting.');
  process.exit(1);
}

// Run cleanout mode if requested
async function startWatching() {
  if (cleanoutMode) {
    await cleanoutUnprocessed();
  }
  
  // Start watching
  console.log('\nWatching for new audio/video files...');
  console.log('Supported formats:', SUPPORTED_EXTENSIONS.join(', '));
  console.log('Press Ctrl+C to stop\n');

  const watcher = chokidar.watch(dirsToWatch, { 
  ignoreInitial: true,
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100
  },
  ignored: [
    '**/temp/**',    // Ignore temp directories
    '**/temp',       // Ignore temp directories
    '**/*.processing', // Ignore lock files
    '**/chunk_*',    // Ignore chunk files
    '**/temp.*'      // Ignore temp.* files
  ]
});

  watcher
    .on('add', processFile)
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