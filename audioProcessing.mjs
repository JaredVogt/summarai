import { exec as execCb, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { startSpinner } from './utils.mjs';
import { loadConfig, getConfigValue } from './configLoader.mjs';

const exec = promisify(execCb);

/**
 * Secure FFmpeg execution using spawn instead of shell execution
 * @param {Array} args - FFmpeg arguments array
 * @param {string} operation - Operation description for logging
 * @returns {Promise} - Promise that resolves when FFmpeg completes
 */
function secureFFmpegCall(args, operation = 'FFmpeg operation') {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    ffmpeg.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${operation} failed with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`${operation} spawn error: ${error.message}`));
    });
  });
}

/**
 * Secure FFprobe execution using spawn instead of shell execution
 * @param {Array} args - FFprobe arguments array
 * @param {string} operation - Operation description for logging
 * @returns {Promise} - Promise that resolves when FFprobe completes
 */
function secureFFprobeCall(args, operation = 'FFprobe operation') {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${operation} failed with code ${code}: ${stderr}`));
      }
    });

    ffprobe.on('error', (error) => {
      reject(new Error(`${operation} spawn error: ${error.message}`));
    });
  });
}

// Load configuration
let config;
try {
  config = loadConfig();
} catch (error) {
  // Fallback to defaults if config cannot be loaded
  console.warn('Warning: Could not load config, using defaults:', error.message);
  config = {
    audio: {
      compression: { normal: { bitrate: '48k', sampleRate: 16000 }, low: { bitrate: '24k', sampleRate: 8000 } },
      processing: { speedAdjustment: 1.5, codec: 'aac', channels: 1, format: 'm4a' },
      chunking: { maxSizeMB: 22, chunkPrefix: 'chunk_' }
    }
  };
}

/**
 * Detects if a file is a video file based on its format information from FFmpeg
 * @param {string} filePath - Path to the file to check
 * @returns {Promise<boolean>} - True if the file is a video
 */
async function isVideoFile(filePath) {
  try {
    // Use secure ffprobe to get file info
    const ffprobeArgs = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type',
      '-of', 'json',
      filePath
    ];
    const { stdout } = await secureFFprobeCall(ffprobeArgs, 'Checking file type');
    const info = JSON.parse(stdout);
    
    // Check if any stream has codec_type 'video'
    return info.streams && info.streams.some(stream => stream.codec_type === 'video');
  } catch (error) {
    console.error('Error detecting file type:', error.message);
    // If we can't detect, assume it's not a video
    return false;
  }
}

/**
 * Converts an audio or video file to a compressed AAC format optimized for transcription
 * @param {string} inputPath - Path to the input audio or video file
 * @param {string} tempDir - Directory to store temporary files
 * @param {Object} [options] - Conversion options
 * @param {boolean} [options.forceAudioExtraction=false] - Force audio extraction mode even for audio files
 * @param {boolean} [options.lowQuality=false] - Use more aggressive compression (smaller files, lower quality)
 * @returns {Promise<string>} - Path to the converted audio file
 */
export async function convertToTempAAC(inputPath, tempDir, { forceAudioExtraction = false, lowQuality = false } = {}) {
  const format = getConfigValue(config, 'audio.processing.format', 'm4a');
  const tempAAC = path.join(tempDir, `temp.${format}`);
  // Ensure tempDir exists
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  // Remove previous temp file if exists
  if (fs.existsSync(tempAAC)) fs.unlinkSync(tempAAC);
  
  // Detect if file is a video
  const isVideo = forceAudioExtraction || await isVideoFile(inputPath);
  const fileType = isVideo ? 'video' : 'audio';
  
  // Start spinner animation for ffmpeg conversion
  const stopSpinner = startSpinner(`Processing ${fileType} file...`);
  
  try {
    let cmd;
    // Get quality parameters from config based on quality setting
    const qualityLevel = lowQuality ? 'low' : 'normal';
    const bitrate = getConfigValue(config, `audio.compression.${qualityLevel}.bitrate`, lowQuality ? '24k' : '48k');
    const samplerate = getConfigValue(config, `audio.compression.${qualityLevel}.sampleRate`, lowQuality ? 8000 : 16000);
    const speedAdjustment = getConfigValue(config, 'audio.processing.speedAdjustment', 1.5);
    const codec = getConfigValue(config, 'audio.processing.codec', 'aac');
    const channels = getConfigValue(config, 'audio.processing.channels', 1);
    
    let ffmpegArgs;
    if (isVideo) {
      // For video files: extract audio and optimize for speech
      ffmpegArgs = [
        '-i', inputPath,
        '-vn',
        '-af', `atempo=${speedAdjustment}`,
        '-c:a', codec,
        '-b:a', bitrate,
        '-ar', samplerate.toString(),
        '-ac', channels.toString(),
        tempAAC,
        '-y'
      ];
      console.log(`Extracting audio from video file (${lowQuality ? 'low' : 'normal'} quality)...`);
    } else {
      // For audio files: just optimize for speech
      ffmpegArgs = [
        '-i', inputPath,
        '-af', `atempo=${speedAdjustment}`,
        '-c:a', codec,
        '-b:a', bitrate,
        '-ar', samplerate.toString(),
        '-ac', channels.toString(),
        tempAAC,
        '-y'
      ];
      console.log(`Processing audio file (${lowQuality ? 'low' : 'normal'} quality)...`);
    }

    const result = await secureFFmpegCall(ffmpegArgs, `Processing ${isVideo ? 'video' : 'audio'} file`);
    stopSpinner(); // Stop the spinner animation when done

    // Validate that output file was created
    if (!fs.existsSync(tempAAC)) {
      throw new Error(`Conversion failed: output file not found at ${tempAAC}. FFmpeg stderr: ${result.stderr}`);
    }

    // Check if output file has reasonable size (> 0 bytes)
    const stats = fs.statSync(tempAAC);
    if (stats.size === 0) {
      throw new Error(`Conversion failed: output file is empty (0 bytes). FFmpeg stderr: ${result.stderr}`);
    }

    console.log(`Converted file size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  } catch (error) {
    stopSpinner(); // Make sure to stop the spinner even if there's an error

    // Clean up any partial output file
    if (fs.existsSync(tempAAC)) {
      try {
        fs.unlinkSync(tempAAC);
      } catch (cleanupError) {
        console.warn(`Warning: Could not clean up partial output file: ${cleanupError.message}`);
      }
    }

    console.error(`Error processing ${fileType} file:`, error.message);
    throw new Error(`Failed to process ${fileType} file: ${error.message}`);
  }
  
  return tempAAC;
}

/**
 * Cleans up the temporary directory used for audio conversion
 * @param {string} tempDir - Directory to clean up
 */
export function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Clean up stale summarai temp directories older than specified age
 * Called on startup to remove orphaned temp dirs from crashed processes
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 1 hour)
 */
export function cleanupStaleTempDirs(maxAgeMs = 3600000) {
  const tempBase = path.join(os.tmpdir(), 'summarai_temp');

  if (!fs.existsSync(tempBase)) {
    return; // Nothing to clean
  }

  try {
    const entries = fs.readdirSync(tempBase, { withFileTypes: true });
    const now = Date.now();
    let cleanedCount = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirPath = path.join(tempBase, entry.name);
      try {
        const stats = fs.statSync(dirPath);
        const age = now - stats.mtimeMs;

        if (age > maxAgeMs) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          cleanedCount++;
        }
      } catch {
        // Ignore individual directory errors
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Cleanup] Removed ${cleanedCount} stale temp director${cleanedCount === 1 ? 'y' : 'ies'}`);
    }
  } catch (error) {
    console.warn(`[Cleanup] Error cleaning stale temp directories: ${error.message}`);
  }
}

/**
 * Splits a large audio file into smaller chunks of specified size
 * @param {string} audioFilePath - Path to the audio file to split
 * @param {string} outputDir - Directory to store the chunks
 * @param {number} maxSizeMB - Maximum size in MB for each chunk
 * @returns {Promise<string[]>} - Array of paths to the chunk files
 */
export async function splitAudioFile(audioFilePath, outputDir, maxSizeMB = null) {
  // Get max size from config if not provided
  if (maxSizeMB === null) {
    maxSizeMB = getConfigValue(config, 'audio.chunking.maxSizeMB', 22);
  }
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  // Get audio duration
  const durationCmd = `ffprobe -v error -show_entries format=duration -of json "${audioFilePath}"`;
  const { stdout: durationOutput } = await exec(durationCmd);
  const duration = JSON.parse(durationOutput).format.duration;
  
  // Get file size
  const stats = fs.statSync(audioFilePath);
  const fileSizeMB = stats.size / (1024 * 1024);
  
  // If file is under the size limit, return the original path
  if (fileSizeMB <= maxSizeMB) {
    return [audioFilePath];
  }
  
  console.log(`File size ${fileSizeMB.toFixed(2)} MB exceeds ${maxSizeMB} MB limit. Splitting into chunks...`);
  
  // Calculate number of chunks needed
  const numberOfChunks = Math.ceil(fileSizeMB / maxSizeMB);
  // Calculate duration of each chunk
  const chunkDuration = Math.ceil(duration / numberOfChunks);
  
  const chunkPaths = [];
  const stopSpinnerSplit = startSpinner('Splitting audio file into chunks...');
  
  try {
    // Get configuration for chunk processing
    const chunkPrefix = getConfigValue(config, 'audio.chunking.chunkPrefix', 'chunk_');
    const speedAdjustment = getConfigValue(config, 'audio.processing.speedAdjustment', 1.5);
    const codec = getConfigValue(config, 'audio.processing.codec', 'aac');
    const bitrate = getConfigValue(config, 'audio.compression.normal.bitrate', '48k');
    const sampleRate = getConfigValue(config, 'audio.compression.normal.sampleRate', 16000);
    const channels = getConfigValue(config, 'audio.processing.channels', 1);
    const format = getConfigValue(config, 'audio.processing.format', 'm4a');
    
    // Split the file into chunks
    for (let i = 0; i < numberOfChunks; i++) {
      const startTime = i * chunkDuration;
      const chunkPath = path.join(outputDir, `${chunkPrefix}${i.toString().padStart(3, '0')}.${format}`);
      
      // Use secure ffmpeg to extract chunk with config settings
      const ffmpegArgs = [
        '-i', audioFilePath,
        '-ss', startTime.toString(),
        '-t', chunkDuration.toString(),
        '-af', `atempo=${speedAdjustment}`,
        '-c:a', codec,
        '-b:a', bitrate,
        '-ar', sampleRate.toString(),
        '-ac', channels.toString(),
        chunkPath,
        '-y'
      ];
      await secureFFmpegCall(ffmpegArgs, `Creating chunk ${i+1}/${numberOfChunks}`);
      
      chunkPaths.push(chunkPath);
      console.log(`Created chunk ${i+1}/${numberOfChunks}: ${chunkPath}`);
    }
    stopSpinnerSplit();
    return chunkPaths;
  } catch (error) {
    stopSpinnerSplit();
    console.error('Error splitting audio file:', error.message);
    throw new Error(`Failed to split audio file: ${error.message}`);
  }
}

/**
 * Format seconds to human-readable time string
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted time string (e.g., "1m 23.45s" or "45.67s")
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(2);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * Parse FFmpeg silencedetect output from stderr
 * @param {string} stderr - FFmpeg stderr output
 * @returns {Array} - Array of silence sections with start, end, duration
 */
function parseSilenceOutput(stderr) {
  const sections = [];
  const lines = stderr.split('\n');
  let currentStart = null;

  for (const line of lines) {
    if (line.includes('silence_start:')) {
      const match = line.match(/silence_start: ([\d.]+)/);
      if (match) currentStart = parseFloat(match[1]);
    }

    if (line.includes('silence_end:')) {
      const match = line.match(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/);
      if (match && currentStart !== null) {
        sections.push({
          start: currentStart,
          end: parseFloat(match[1]),
          duration: parseFloat(match[2])
        });
        currentStart = null;
      }
    }
  }

  return sections;
}

/**
 * Preview silence detection without modifying the file
 * Uses FFmpeg's silencedetect filter to report what WOULD be removed
 * @param {string} audioFile - Path to audio file
 * @param {number} threshold - dB threshold (default: -25)
 * @param {number} minDuration - Minimum silence duration in seconds (default: 0.5)
 * @returns {Promise<Object>} - Object with sections array, totalSilence, and formatTime function
 */
export async function previewSilenceRemoval(audioFile, threshold = -25, minDuration = 0.5) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', audioFile,
      '-af', `silencedetect=n=${threshold}dB:d=${minDuration}`,
      '-f', 'null',
      '-'
    ]);

    let stderrOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      const sections = parseSilenceOutput(stderrOutput);
      const totalSilence = sections.reduce((sum, s) => sum + s.duration, 0);
      resolve({ sections, totalSilence, formatTime });
    });

    ffmpeg.on('error', reject);
  });
}
