/**
 * Input validation and sanitization utilities
 * Provides secure validation for all user inputs and file operations
 */

import path from 'path';
import fs from 'fs';

/**
 * Validates and sanitizes file paths to prevent path traversal attacks
 * @param {string} filePath - The file path to validate
 * @param {boolean} mustExist - Whether the file must exist
 * @returns {string} - Normalized and validated file path
 * @throws {ValidationError} - If path is invalid or unsafe
 */
export function validateFilePath(filePath, mustExist = false) {
  if (!filePath || typeof filePath !== 'string') {
    throw new ValidationError('Invalid file path: must be a non-empty string', 'filePath');
  }
  
  // Normalize the path to resolve any relative components
  const normalized = path.normalize(filePath);
  
  // Prevent path traversal attacks
  if (normalized.includes('..') || normalized.startsWith('/etc/') || normalized.startsWith('/usr/')) {
    throw new ValidationError('Invalid file path: path traversal or system directory access detected', 'filePath');
  }
  
  // Check for null bytes (common in path injection attacks)
  if (normalized.includes('\0')) {
    throw new ValidationError('Invalid file path: null byte detected', 'filePath');
  }
  
  // If file must exist, check it
  if (mustExist && !fs.existsSync(normalized)) {
    throw new ValidationError(`File does not exist: ${normalized}`, 'filePath');
  }
  
  return normalized;
}

/**
 * Validates audio processing options
 * @param {Object} options - Audio processing options
 * @returns {Object} - Validated and sanitized options
 * @throws {ValidationError} - If options are invalid
 */
export function validateAudioOptions(options = {}) {
  const validated = {};
  
  // Validate bitrate
  if (options.bitrate) {
    if (typeof options.bitrate !== 'string' || !/^\d+k$/.test(options.bitrate)) {
      throw new ValidationError('Invalid bitrate format: must be like "48k", "24k"', 'bitrate');
    }
    const bitrateNum = parseInt(options.bitrate);
    if (bitrateNum < 8 || bitrateNum > 320) {
      throw new ValidationError('Invalid bitrate: must be between 8k and 320k', 'bitrate');
    }
    validated.bitrate = options.bitrate;
  }
  
  // Validate sample rate
  if (options.sampleRate) {
    const sampleRate = parseInt(options.sampleRate);
    if (isNaN(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
      throw new ValidationError('Invalid sample rate: must be between 8000 and 48000', 'sampleRate');
    }
    validated.sampleRate = sampleRate;
  }
  
  // Validate channels
  if (options.channels !== undefined) {
    const channels = parseInt(options.channels);
    if (isNaN(channels) || channels < 1 || channels > 2) {
      throw new ValidationError('Invalid channels: must be 1 (mono) or 2 (stereo)', 'channels');
    }
    validated.channels = channels;
  }
  
  // Validate speed adjustment
  if (options.speedAdjustment) {
    const speed = parseFloat(options.speedAdjustment);
    if (isNaN(speed) || speed < 0.5 || speed > 3.0) {
      throw new ValidationError('Invalid speed adjustment: must be between 0.5 and 3.0', 'speedAdjustment');
    }
    validated.speedAdjustment = speed;
  }
  
  // Validate codec
  if (options.codec) {
    const allowedCodecs = ['aac', 'mp3', 'opus', 'flac'];
    if (!allowedCodecs.includes(options.codec)) {
      throw new ValidationError(`Invalid codec: must be one of ${allowedCodecs.join(', ')}`, 'codec');
    }
    validated.codec = options.codec;
  }
  
  return validated;
}

/**
 * Validates transcription service options
 * @param {Object} options - Transcription options
 * @returns {Object} - Validated options
 * @throws {ValidationError} - If options are invalid
 */
export function validateTranscriptionOptions(options = {}) {
  const validated = {};
  
  // Validate transcription service
  if (options.transcriptionService) {
    const allowedServices = ['whisper', 'scribe'];
    if (!allowedServices.includes(options.transcriptionService)) {
      throw new ValidationError(`Invalid transcription service: must be one of ${allowedServices.join(', ')}`, 'transcriptionService');
    }
    validated.transcriptionService = options.transcriptionService;
  }
  
  // Validate model
  if (options.model !== undefined) {
    if (typeof options.model !== 'string' || options.model.length < 3) {
      throw new ValidationError('Invalid model: must be a non-empty string', 'model');
    }
    validated.model = options.model;
  }
  
  // Validate max speakers
  if (options.maxSpeakers !== undefined && options.maxSpeakers !== null) {
    const maxSpeakers = parseInt(options.maxSpeakers);
    if (isNaN(maxSpeakers) || maxSpeakers < 1 || maxSpeakers > 32) {
      throw new ValidationError('Invalid maxSpeakers: must be between 1 and 32', 'maxSpeakers');
    }
    validated.maxSpeakers = maxSpeakers;
  }
  
  return validated;
}

/**
 * Validates API keys
 * @param {Object} keys - Object containing API keys
 * @throws {ValidationError} - If keys are missing or invalid
 */
export function validateApiKeys(keys = {}) {
  const required = [
    { key: 'ANTHROPIC_API_KEY', minLength: 20 },
    { key: 'ELEVENLABS_API_KEY', minLength: 20 }
  ];
  
  const missing = [];
  const invalid = [];
  
  for (const { key, minLength } of required) {
    const value = keys[key] || process.env[key];
    if (!value) {
      missing.push(key);
    } else if (value.length < minLength) {
      invalid.push(`${key} (too short)`);
    }
  }
  
  if (missing.length > 0) {
    throw new ValidationError(`Missing API keys: ${missing.join(', ')}`, 'apiKeys');
  }
  
  if (invalid.length > 0) {
    throw new ValidationError(`Invalid API keys: ${invalid.join(', ')}`, 'apiKeys');
  }
}

/**
 * Validates command line arguments
 * @param {Array} args - Command line arguments
 * @returns {Object} - Parsed and validated arguments
 */
export function validateCommandLineArgs(args = []) {
  const validated = {
    filePath: null,
    options: {},
    flags: []
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // Handle flags
    if (arg.startsWith('--')) {
      const flag = arg.substring(2);
      const allowedFlags = ['silent', 'dry-run', 'cleanout', 'help', 'whisper', 'scribe', 'low-quality'];
      
      if (!allowedFlags.includes(flag)) {
        throw new ValidationError(`Unknown flag: --${flag}`, 'commandLine');
      }
      
      validated.flags.push(flag);
    } else if (!arg.startsWith('-') && !validated.filePath) {
      // First non-flag argument is the file path
      validated.filePath = validateFilePath(arg);
    }
  }
  
  return validated;
}

/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Sanitizes filename for safe file system operations
 * @param {string} filename - Original filename
 * @returns {string} - Sanitized filename
 */
export function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new ValidationError('Invalid filename: must be a non-empty string', 'filename');
  }
  
  // Remove or replace dangerous characters
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid filename characters
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, 255); // Limit length
}

/**
 * Validates file size limits
 * @param {string} filePath - Path to file
 * @param {number} maxSizeMB - Maximum size in MB
 * @throws {ValidationError} - If file is too large
 */
export function validateFileSize(filePath, maxSizeMB = 1024) {
  const stats = fs.statSync(filePath);
  const fileSizeMB = stats.size / (1024 * 1024);
  
  if (fileSizeMB > maxSizeMB) {
    throw new ValidationError(
      `File size ${fileSizeMB.toFixed(2)}MB exceeds limit of ${maxSizeMB}MB`,
      'fileSize'
    );
  }
  
  return fileSizeMB;
}

/**
 * Validate file integrity using ffprobe
 * @param {string} filePath - Path to the file
 * @param {string} validationLevel - Validation level: "none", "moov", "full"
 * @returns {Promise<boolean>} - True if file is valid
 * @throws {ValidationError} - If file is invalid or validation fails
 */
export async function validateFileIntegrity(filePath, validationLevel = 'moov') {
  if (validationLevel === 'none') {
    return true;
  }

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    if (validationLevel === 'moov') {
      // Quick check for moov atom presence (faster)
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'format=format_name',
        '-of', 'json',
        filePath
      ]);
      
      const probe = JSON.parse(stdout);
      if (!probe.format || !probe.format.format_name) {
        throw new ValidationError(
          'File appears to be corrupted or incomplete (missing format information)',
          'fileIntegrity'
        );
      }
      
      // For M4A files, specifically check if it's a valid container
      if (filePath.toLowerCase().endsWith('.m4a')) {
        if (!probe.format.format_name.includes('mov') && 
            !probe.format.format_name.includes('mp4')) {
          throw new ValidationError(
            'M4A file appears to be missing moov atom or is corrupted',
            'fileIntegrity'
          );
        }
      }
    } else if (validationLevel === 'full') {
      // Full validation - slower but more thorough
      await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name',
        '-of', 'json',
        filePath
      ]);
    }
    
    return true;
  } catch (error) {
    if (error.stderr && error.stderr.includes('moov atom not found')) {
      throw new ValidationError(
        'File is incomplete or corrupted (moov atom not found)',
        'fileIntegrity',
        { originalError: error }
      );
    } else if (error.stderr && error.stderr.includes('Invalid data found')) {
      throw new ValidationError(
        'File contains invalid data or is corrupted',
        'fileIntegrity',
        { originalError: error }
      );
    } else if (error instanceof ValidationError) {
      throw error;
    } else {
      throw new ValidationError(
        `File validation failed: ${error.message}`,
        'fileIntegrity',
        { originalError: error }
      );
    }
  }
}

/**
 * Validates speaker profile name
 * @param {string} name - Profile name to validate
 * @returns {string} - Sanitized profile name
 * @throws {ValidationError} - If name is invalid
 */
export function validateProfileName(name) {
  if (!name || typeof name !== 'string') {
    throw new ValidationError('Profile name must be a non-empty string', 'profileName');
  }

  // Trim and normalize whitespace
  const trimmed = name.trim().replace(/\s+/g, ' ');

  if (trimmed.length < 2) {
    throw new ValidationError('Profile name must be at least 2 characters', 'profileName');
  }

  if (trimmed.length > 50) {
    throw new ValidationError('Profile name must be 50 characters or less', 'profileName');
  }

  // Only allow alphanumeric, spaces, hyphens, underscores, and apostrophes
  if (!/^[a-zA-Z0-9\s\-_']+$/.test(trimmed)) {
    throw new ValidationError(
      'Profile name contains invalid characters. Use letters, numbers, spaces, hyphens, underscores, or apostrophes.',
      'profileName'
    );
  }

  return trimmed;
}

/**
 * Validates speaker identification options
 * @param {Object} options - Speaker ID options
 * @returns {Object} - Validated options
 * @throws {ValidationError} - If options are invalid
 */
export function validateSpeakerIdOptions(options = {}) {
  const validated = {};

  // Validate threshold (0.0 - 1.0)
  if (options.threshold !== undefined) {
    const threshold = parseFloat(options.threshold);
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      throw new ValidationError(
        'Speaker identification threshold must be between 0.0 and 1.0',
        'threshold'
      );
    }
    validated.threshold = threshold;
  }

  // Validate timeout (positive integer, reasonable range)
  if (options.timeout !== undefined) {
    const timeout = parseInt(options.timeout);
    if (isNaN(timeout) || timeout < 1000 || timeout > 300000) {
      throw new ValidationError(
        'Speaker identification timeout must be between 1000ms and 300000ms (5 minutes)',
        'timeout'
      );
    }
    validated.timeout = timeout;
  }

  // Validate profiles directory path if provided
  if (options.profilesDir) {
    validated.profilesDir = validateFilePath(options.profilesDir, false);
  }

  return validated;
}
