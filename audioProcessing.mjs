import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { startSpinner } from './utils.mjs';
import { loadConfig, getConfigValue } from './configLoader.mjs';

const exec = promisify(execCb);

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
    // Use ffprobe to get file info
    const cmd = `ffprobe -v error -show_entries stream=codec_type -of json "${filePath}"`;
    const { stdout } = await exec(cmd);
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
    
    if (isVideo) {
      // For video files: extract audio and optimize for speech
      cmd = `ffmpeg -i "${inputPath}" -vn -af "atempo=${speedAdjustment}" -c:a ${codec} -b:a ${bitrate} -ar ${samplerate} -ac ${channels} "${tempAAC}" -y`;
      console.log(`Extracting audio from video file (${lowQuality ? 'low' : 'normal'} quality)...`);
    } else {
      // For audio files: just optimize for speech
      cmd = `ffmpeg -i "${inputPath}" -af "atempo=${speedAdjustment}" -c:a ${codec} -b:a ${bitrate} -ar ${samplerate} -ac ${channels} "${tempAAC}" -y`;
      console.log(`Processing audio file (${lowQuality ? 'low' : 'normal'} quality)...`);
    }
    
    await exec(cmd);
    stopSpinner(); // Stop the spinner animation when done
  } catch (error) {
    stopSpinner(); // Make sure to stop the spinner even if there's an error
    console.error(`Error processing ${fileType} file:`, error.message);
    throw new Error(`Failed to process ${fileType} file: ${error.message}`);
  }
  
  // Log out the resulting file size
  if (fs.existsSync(tempAAC)) {
    const stats = fs.statSync(tempAAC);
    console.log(`Converted file size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  } else {
    throw new Error('Conversion failed: output file not found');
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
      
      // Use ffmpeg to extract chunk with config settings
      const cmd = `ffmpeg -i "${audioFilePath}" -ss ${startTime} -t ${chunkDuration} -af "atempo=${speedAdjustment}" -c:a ${codec} -b:a ${bitrate} -ar ${sampleRate} -ac ${channels} "${chunkPath}" -y`;
      await exec(cmd);
      
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
