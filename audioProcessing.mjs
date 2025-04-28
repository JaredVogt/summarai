import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { startSpinner } from './utils.mjs';

const exec = promisify(execCb);

/**
 * Converts an audio file to a compressed AAC format optimized for transcription
 * @param {string} inputPath - Path to the input audio file
 * @param {string} tempDir - Directory to store temporary files
 * @returns {Promise<string>} - Path to the converted audio file
 */
export async function convertToTempAAC(inputPath, tempDir) {
  const tempAAC = path.join(tempDir, 'temp.m4a');
  // Ensure tempDir exists
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  // Remove previous temp file if exists
  if (fs.existsSync(tempAAC)) fs.unlinkSync(tempAAC);
  
  // Start spinner animation for ffmpeg conversion
  const stopSpinner = startSpinner('Converting audio file...');
  
  const cmd = `ffmpeg -i "${inputPath}" -c:a aac -b:a 48k -ar 16000 -ac 1 "${tempAAC}" -y`;
  try {
    await exec(cmd);
    stopSpinner(); // Stop the spinner animation when done
  } catch (error) {
    stopSpinner(); // Make sure to stop the spinner even if there's an error
    throw error; // Re-throw the error for the caller to handle
  }
  
  // Log out the resulting file size
  if (fs.existsSync(tempAAC)) {
    const stats = fs.statSync(tempAAC);
    console.log(`Converted file size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
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
