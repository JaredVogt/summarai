/**
 * YouTube Input Handler
 *
 * Handles YouTube-specific processing:
 * - URL validation and video ID extraction
 * - Audio download via yt-dlp
 * - Video metadata extraction
 * - YouTube transcript fallback (via youtube-transcript-plus)
 *
 * Returns a normalized input object for the core pipeline.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProcessingError, ValidationError, ApiError } from '../src/errors.mjs';

const exec = promisify(execCb);

// ============================================================================
// Constants
// ============================================================================

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const SUPPORTED_HOSTS = new Set([
  'youtu.be',
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com'
]);

// ============================================================================
// YouTube-Specific Error Classes
// ============================================================================

/**
 * YouTube-specific errors (video unavailable, private, region-restricted, etc.)
 */
export class YouTubeError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'YouTubeError';
    this.code = 'YOUTUBE_ERROR';
    this.context = context;
    this.isOperational = true;
  }
}

/**
 * Network-related errors
 */
export class NetworkError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'NetworkError';
    this.code = 'NETWORK_ERROR';
    this.context = context;
    this.isOperational = true;
  }
}

// ============================================================================
// YouTube Transcript Client (lazy-loaded)
// ============================================================================

let youtubeTranscriptClient = null;

async function loadYoutubeTranscript() {
  if (youtubeTranscriptClient) {
    return youtubeTranscriptClient;
  }

  try {
    const module = await import('youtube-transcript-plus');
    const exported = module?.YoutubeTranscript || module?.default;

    if (!exported) {
      throw new Error('youtube-transcript-plus export not found');
    }

    youtubeTranscriptClient = exported;
    return youtubeTranscriptClient;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || /cannot find module/i.test(error?.message || '')) {
      console.warn('youtube-transcript-plus not installed - YouTube transcript fallback unavailable');
      return null;
    }
    throw error;
  }
}

// ============================================================================
// URL Validation and Video ID Extraction
// ============================================================================

/**
 * Validate that a string looks like a YouTube URL
 * @param {string} url - URL to validate
 * @throws {ValidationError} If URL is invalid
 */
function validateYouTubeUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new ValidationError('YouTube URL is required', 'url');
  }

  const trimmed = url.trim();

  // If it's already a video ID, it's valid
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return;
  }

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (!SUPPORTED_HOSTS.has(parsed.hostname)) {
      throw new ValidationError(`Unsupported YouTube host: ${parsed.hostname}`, 'url');
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid YouTube URL format', 'url');
  }
}

/**
 * Extract the 11-character YouTube video ID from a URL or raw ID.
 * @param {string} input - YouTube URL or video ID
 * @returns {string} - Normalized video ID
 * @throws {ValidationError|YouTubeError} - On invalid input or parse failure
 */
export function extractVideoId(input) {
  if (!input || typeof input !== 'string') {
    throw new ValidationError('YouTube URL or video ID is required', 'input');
  }

  const trimmed = input.trim();

  // Already a video ID
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  validateYouTubeUrl(trimmed);

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);

    // Handle youtu.be short URLs
    if (parsed.hostname === 'youtu.be') {
      const candidate = parsed.pathname.replace(/^\//, '').slice(0, 11);
      if (VIDEO_ID_PATTERN.test(candidate)) return candidate;
    }

    // Handle ?v= parameter
    if (parsed.searchParams.has('v')) {
      const candidate = parsed.searchParams.get('v');
      if (candidate && VIDEO_ID_PATTERN.test(candidate)) return candidate;
    }

    // Try extracting from path (e.g., /watch/VIDEO_ID)
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const candidate = pathParts[pathParts.length - 1];
    if (candidate && VIDEO_ID_PATTERN.test(candidate)) {
      return candidate;
    }

    throw new YouTubeError('Could not extract video ID from URL', { input: trimmed });
  } catch (error) {
    if (error instanceof YouTubeError || error instanceof ValidationError) {
      throw error;
    }
    throw new YouTubeError(`Failed to parse YouTube URL: ${error.message}`, { input: trimmed });
  }
}

// ============================================================================
// Console Spinner Utility
// ============================================================================

function startSpinner(message) {
  const spinnerChars = ['|', '/', '-', '\\'];
  let i = 0;
  process.stdout.write(message);
  const interval = setInterval(() => {
    process.stdout.write(`\r${message} ${spinnerChars[i++ % spinnerChars.length]}`);
  }, 100);
  return () => {
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(message.length + 2) + '\r');
  };
}

// ============================================================================
// yt-dlp Integration
// ============================================================================

/**
 * Check if yt-dlp is installed and accessible
 * @returns {Promise<boolean>}
 */
export async function checkYtDlpInstalled() {
  try {
    await exec('yt-dlp --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Download audio from a YouTube video using yt-dlp
 * @param {string} url - YouTube video URL or ID
 * @param {Object} [options={}] - Download options
 * @param {string} [options.outputDir] - Directory to save the audio file
 * @param {boolean} [options.lowQuality=false] - Use lower quality audio
 * @param {string} [options.format='m4a'] - Audio format
 * @returns {Promise<string>} Path to the downloaded audio file
 */
export async function downloadYouTubeAudio(url, options = {}) {
  validateYouTubeUrl(url);

  const {
    outputDir = path.join(os.tmpdir(), 'summarai_youtube'),
    lowQuality = false,
    format = 'm4a'
  } = options;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const outputTemplate = path.join(outputDir, `yt_${timestamp}_%(title)s.%(ext)s`);

  // Build yt-dlp command
  const audioQuality = lowQuality ? '5' : '0';
  const command = [
    'yt-dlp',
    '-x',
    '--audio-format', format,
    '--audio-quality', audioQuality,
    '-o', `"${outputTemplate}"`,
    '--no-playlist',
    '--no-warnings',
    '--print', 'after_move:filepath',
    `"${url}"`
  ].join(' ');

  const stopSpinner = startSpinner('Downloading audio from YouTube...');

  try {
    const { stdout } = await exec(command, {
      maxBuffer: 10 * 1024 * 1024
    });

    stopSpinner();

    const lines = stdout.trim().split('\n');
    const downloadedFile = lines[lines.length - 1].trim();

    if (!downloadedFile || !fs.existsSync(downloadedFile)) {
      throw new ProcessingError('Failed to download audio file', { url });
    }

    const stats = fs.statSync(downloadedFile);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`Downloaded: ${path.basename(downloadedFile)} (${fileSizeMB} MB)`);

    return downloadedFile;

  } catch (error) {
    stopSpinner();

    if (error.message.includes('command not found') || error.message.includes('is not recognized')) {
      throw new ProcessingError(
        'yt-dlp is not installed. Install with: brew install yt-dlp',
        { url }
      );
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      throw new NetworkError('Network connection failed', { url, errorCode: error.code });
    }

    if (error.message.includes('Video unavailable') || error.message.includes('Private video')) {
      throw new YouTubeError('Video is unavailable (private, deleted, or region-restricted)', { url });
    }

    if (error.message.includes('age-restricted')) {
      throw new YouTubeError('Video is age-restricted and requires authentication', { url });
    }

    if (error.message.includes('copyright') || error.message.includes('blocked')) {
      throw new YouTubeError('Video is blocked due to copyright restrictions', { url });
    }

    throw new ProcessingError(`Failed to download audio: ${error.message}`, { url });
  }
}

/**
 * Download video from YouTube using yt-dlp
 * @param {string} url - YouTube video URL or ID
 * @param {Object} [options={}] - Download options
 * @param {string} [options.outputDir] - Directory to save the video file
 * @param {string} [options.outputFilename] - Custom filename (without extension)
 * @param {string} [options.format='mp4'] - Video format
 * @returns {Promise<string>} Path to the downloaded video file
 */
export async function downloadYouTubeVideo(url, options = {}) {
  validateYouTubeUrl(url);

  const {
    outputDir = path.join(os.tmpdir(), 'summarai_youtube'),
    outputFilename = null,
    format = 'mp4'
  } = options;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Use custom filename if provided, otherwise use title
  const outputTemplate = outputFilename
    ? path.join(outputDir, `${outputFilename}.%(ext)s`)
    : path.join(outputDir, `%(title)s.%(ext)s`);

  // Build yt-dlp command for video download
  // Use format that prioritizes mp4 with reasonable quality
  const command = [
    'yt-dlp',
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', format,
    '-o', `"${outputTemplate}"`,
    '--no-playlist',
    '--no-warnings',
    '--print', 'after_move:filepath',
    `"${url}"`
  ].join(' ');

  const stopSpinner = startSpinner('Downloading video from YouTube...');

  try {
    const { stdout } = await exec(command, {
      maxBuffer: 50 * 1024 * 1024
    });

    stopSpinner();

    const lines = stdout.trim().split('\n');
    const downloadedFile = lines[lines.length - 1].trim();

    if (!downloadedFile || !fs.existsSync(downloadedFile)) {
      throw new ProcessingError('Failed to download video file', { url });
    }

    const stats = fs.statSync(downloadedFile);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`Downloaded video: ${path.basename(downloadedFile)} (${fileSizeMB} MB)`);

    return downloadedFile;

  } catch (error) {
    stopSpinner();

    if (error.message.includes('command not found') || error.message.includes('is not recognized')) {
      throw new ProcessingError(
        'yt-dlp is not installed. Install with: brew install yt-dlp',
        { url }
      );
    }

    throw new ProcessingError(`Failed to download video: ${error.message}`, { url });
  }
}

/**
 * Get video metadata without downloading
 * @param {string} url - YouTube video URL or ID
 * @returns {Promise<Object>} Video metadata
 */
export async function getVideoMetadata(url) {
  try {
    const command = `yt-dlp --dump-json --no-warnings "${url}"`;
    const { stdout } = await exec(command, {
      maxBuffer: 10 * 1024 * 1024
    });

    const metadata = JSON.parse(stdout);

    if (!metadata.title && !metadata.id) {
      throw new Error('Invalid metadata received');
    }

    return metadata;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProcessingError('Failed to parse video metadata', { url });
    }

    if (error.message.includes('command not found')) {
      throw new ProcessingError('yt-dlp is not installed', { url });
    }

    if (error.message.includes('Video unavailable') || error.message.includes('Private video')) {
      throw new YouTubeError('Cannot access video metadata', { url });
    }

    throw new ProcessingError(`Failed to get video metadata: ${error.message}`, { url });
  }
}

// ============================================================================
// YouTube Transcript Fetching
// ============================================================================

/**
 * Format seconds to MM:SS
 * @param {number} seconds
 * @returns {string}
 */
export function formatTimestamp(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format transcript entries
 * @param {Array} entries - Transcript entries
 * @param {Object} options
 * @param {boolean} [options.timestamps=false] - Include timestamps
 * @returns {string}
 */
export function formatTranscript(entries, { timestamps = false } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return '';
  }

  const cleaned = entries
    .map((entry) => {
      if (!entry || typeof entry.text !== 'string') return null;
      const text = entry.text.replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return {
        text,
        offset: typeof entry.offset === 'number' ? entry.offset : Number(entry.offset) || 0
      };
    })
    .filter(Boolean);

  if (cleaned.length === 0) {
    return '';
  }

  if (!timestamps) {
    return cleaned.map((entry) => entry.text).join(' ');
  }

  return cleaned
    .map((entry) => `[${formatTimestamp(entry.offset)}] ${entry.text}`)
    .join('\n');
}

/**
 * Fetch YouTube transcript with language fallback
 * @param {string} videoId - 11-character video ID
 * @param {Object} options
 * @param {string} [options.language='en'] - Preferred language
 * @param {boolean} [options.fallback=true] - Try any language if preferred unavailable
 * @returns {Promise<{ entries: Array, language: string|null, isFallback: boolean }|null>}
 */
export async function fetchTranscript(videoId, { language = 'en', fallback = true } = {}) {
  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    throw new ValidationError('Valid 11-character YouTube video ID required', 'videoId');
  }

  const TranscriptClient = await loadYoutubeTranscript();

  if (!TranscriptClient) {
    console.log('YouTube transcript client not available - skipping transcript fetch');
    return null;
  }

  const requestOptions = {};
  if (language) {
    requestOptions.lang = language;
  }

  try {
    const entries = await TranscriptClient.fetchTranscript(videoId, requestOptions);
    return { entries, language: language || null, isFallback: false };
  } catch (error) {
    const normalized = (error?.message || '').toLowerCase();

    const shouldRetryWithoutLang = Boolean(
      language &&
      fallback &&
      (
        normalized.includes('not available') ||
        normalized.includes('no transcript') ||
        normalized.includes('could not find transcript') ||
        normalized.includes('notfound') ||
        normalized.includes('disabled')
      )
    );

    if (shouldRetryWithoutLang) {
      try {
        const entries = await TranscriptClient.fetchTranscript(videoId);
        return { entries, language: null, isFallback: true };
      } catch {
        // Transcript not available - this is OK, we'll use Scribe
        console.log('YouTube transcript not available - will use audio transcription');
        return null;
      }
    }

    // Transcript not available - this is OK
    console.log('YouTube transcript not available - will use audio transcription');
    return null;
  }
}

/**
 * Get formatted transcript in one call
 * @param {string} videoId - YouTube video ID
 * @param {Object} options
 * @returns {Promise<{ text: string, language: string|null, isFallback: boolean }|null>}
 */
export async function getFormattedTranscript(videoId, { language = 'en', timestamps = false } = {}) {
  const result = await fetchTranscript(videoId, { language, fallback: true });

  if (!result) {
    return null;
  }

  return {
    text: formatTranscript(result.entries, { timestamps }),
    language: result.language,
    isFallback: result.isFallback
  };
}

// ============================================================================
// Main Handler: Process YouTube URL
// ============================================================================

/**
 * Process a YouTube URL and return normalized input for the core pipeline.
 *
 * This is the main entry point for YouTube processing.
 *
 * @param {string} url - YouTube URL or video ID
 * @param {Object} options - Processing options
 * @param {boolean} [options.lowQuality=false] - Use lower quality audio
 * @param {string} [options.outputDir] - Custom output directory for download
 * @param {boolean} [options.skipTranscriptFetch=false] - Skip YouTube transcript fetch
 * @returns {Promise<Object>} Normalized input for core pipeline
 */
export async function processYouTubeUrl(url, options = {}) {
  const {
    lowQuality = false,
    outputDir,
    skipTranscriptFetch = false
  } = options;

  console.log('\n--- YouTube Input Handler ---');

  // 1. Extract and validate video ID
  const videoId = extractVideoId(url);
  console.log(`Video ID: ${videoId}`);

  // 2. Fetch video metadata
  console.log('Fetching video metadata...');
  const metadata = await getVideoMetadata(url);
  console.log(`Title: ${metadata.title}`);
  console.log(`Duration: ${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60).toString().padStart(2, '0')}`);

  // 3. Try to get YouTube transcript (for fallback/reference)
  let fallbackTranscript = null;
  if (!skipTranscriptFetch) {
    console.log('Attempting to fetch YouTube transcript...');
    const transcriptResult = await getFormattedTranscript(videoId, { timestamps: true });
    if (transcriptResult) {
      fallbackTranscript = transcriptResult.text;
      console.log(`YouTube transcript available (${transcriptResult.isFallback ? 'auto-detected' : transcriptResult.language})`);
    }
  }

  // 4. Download audio via yt-dlp
  const audioPath = await downloadYouTubeAudio(url, { lowQuality, outputDir });

  // 5. Return normalized input for core pipeline
  return {
    audioPath,
    metadata: {
      title: metadata.title,
      duration: metadata.duration,
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      uploader: metadata.uploader || metadata.channel || null,
      uploadDate: metadata.upload_date || null,
      description: metadata.description?.substring(0, 500) || null,
      sourceType: 'youtube',
      recordingDateTime: new Date().toISOString()
    },
    fallbackTranscript,
    sourceType: 'youtube'
  };
}

export default {
  processYouTubeUrl,
  extractVideoId,
  downloadYouTubeAudio,
  getVideoMetadata,
  fetchTranscript,
  getFormattedTranscript,
  checkYtDlpInstalled,
  YouTubeError,
  NetworkError
};
