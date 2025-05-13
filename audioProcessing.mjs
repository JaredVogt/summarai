import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { startSpinner } from './utils.mjs';

const exec = promisify(execCb);

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
 * @param {boolean} [forceAudioExtraction=false] - Force audio extraction mode even for audio files
 * @returns {Promise<string>} - Path to the converted audio file
 */
export async function convertToTempAAC(inputPath, tempDir, forceAudioExtraction = false) {
  const tempAAC = path.join(tempDir, 'temp.m4a');
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
    if (isVideo) {
      // For video files: extract audio and optimize for speech
      cmd = `ffmpeg -i "${inputPath}" -vn -c:a aac -b:a 48k -ar 16000 -ac 1 "${tempAAC}" -y`;
      console.log('Extracting audio from video file...');
    } else {
      // For audio files: just optimize for speech
      cmd = `ffmpeg -i "${inputPath}" -c:a aac -b:a 48k -ar 16000 -ac 1 "${tempAAC}" -y`;
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
