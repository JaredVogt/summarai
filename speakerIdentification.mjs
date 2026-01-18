import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { loadConfig, getConfigValue } from './configLoader.mjs';
import logger, { LogCategory, LogStatus } from './src/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the base directory for external resources (pyannote scripts, etc.)
 * When running as a bundled executable, use the executable's directory
 * When running from source, use the module's directory
 */
function getBaseDir() {
  // Check if we're running from a Bun bundle by checking if __dirname is virtual
  if (__dirname.startsWith('/$bunfs') || __dirname.startsWith('/snapshot')) {
    // Running from bundled executable - use executable's directory
    return path.dirname(process.execPath);
  }
  // Running from source
  return __dirname;
}

// Load configuration
let config;
try {
  config = loadConfig();
} catch (error) {
  config = null;
}

/**
 * Expand ~ and environment variables in path
 * @param {string} pathStr - Path string to expand
 * @returns {string} - Expanded path
 */
function expandPath(pathStr) {
  if (!pathStr) return pathStr;
  if (pathStr.startsWith('~')) {
    pathStr = path.join(os.homedir(), pathStr.slice(1));
  }
  return pathStr;
}

/**
 * Execute Python speaker identification script
 * @param {string} action - Action to perform (check, enroll, identify, list, delete)
 * @param {Object} inputData - Data to pass to Python script
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} - Result from Python script
 */
function executePythonScript(action, inputData, options = {}) {
  return new Promise((resolve, reject) => {
    const pythonPath = options.pythonPath ||
      getConfigValue(config, 'speakerIdentification.python.path', 'python3');
    const timeoutMs = options.timeout ||
      getConfigValue(config, 'speakerIdentification.python.timeout', 60000);
    const scriptPath = path.join(getBaseDir(), 'pyannote', 'speaker_id.py');

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`Python script not found: ${scriptPath}`));
      return;
    }

    // Add action to input data
    const fullInputData = {
      action,
      ...inputData,
      huggingface_token: inputData.huggingface_token ||
        process.env.HUGGINGFACE_TOKEN ||
        getConfigValue(config, 'speakerIdentification.huggingfaceToken', null)
    };

    const python = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      python.kill('SIGTERM');
    }, timeoutMs);

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      clearTimeout(timeoutHandle);

      if (timedOut) {
        reject(new Error(`Python script timed out after ${timeoutMs}ms`));
        return;
      }

      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          if (result.success === false) {
            const error = new Error(result.error || 'Python script returned error');
            error.errorType = result.error_type;
            reject(error);
          } else {
            resolve(result);
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse Python output: ${parseError.message}\nOutput: ${stdout}`));
        }
      } else {
        // Check if there's JSON error in stdout
        try {
          const result = JSON.parse(stdout);
          if (result.error) {
            const error = new Error(result.error);
            error.errorType = result.error_type;
            reject(error);
            return;
          }
        } catch (e) {
          // Not JSON, use stderr
        }
        reject(new Error(`Python script failed with code ${code}: ${stderr || stdout}`));
      }
    });

    python.on('error', (error) => {
      clearTimeout(timeoutHandle);
      if (error.code === 'ENOENT') {
        reject(new Error(`Python not found at '${pythonPath}'. Install Python 3.8+ or configure speakerIdentification.python.path`));
      } else {
        reject(new Error(`Python spawn error: ${error.message}`));
      }
    });

    // Write input data to stdin
    python.stdin.write(JSON.stringify(fullInputData));
    python.stdin.end();
  });
}

/**
 * Check Python environment and dependencies
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<Object>} - Environment status
 */
export async function checkPythonEnvironment(verbose = false) {
  try {
    const result = await executePythonScript('check', {});

    if (verbose) {
      logger.info(LogCategory.SYSTEM, `Python environment: ${result.python_version}`);
      logger.info(LogCategory.SYSTEM, `HuggingFace token: ${result.huggingface_token_status}`);
    }

    return {
      available: true,
      pythonVersion: result.python_version,
      huggingfaceTokenStatus: result.huggingface_token_status
    };
  } catch (error) {
    if (verbose) {
      logger.warn(LogCategory.SYSTEM, `Speaker identification unavailable: ${error.message}`);
    }

    return {
      available: false,
      error: error.message,
      errorType: error.errorType
    };
  }
}

/**
 * Enroll a new speaker profile
 * @param {string} name - Display name for the speaker
 * @param {string} audioPath - Path to audio sample (10-60 seconds recommended)
 * @param {Object} options - Enrollment options
 * @returns {Promise<Object>} - Enrollment result
 */
export async function enrollSpeaker(name, audioPath, options = {}) {
  const profilesDir = expandPath(
    options.profilesDir ||
    getConfigValue(config, 'speakerIdentification.profilesDir', '~/.summarai/profiles')
  );

  // Validate audio file exists
  const expandedAudioPath = expandPath(audioPath);
  if (!fs.existsSync(expandedAudioPath)) {
    throw new Error(`Audio file not found: ${expandedAudioPath}`);
  }

  logger.processing(LogCategory.PROCESSING, `Enrolling speaker "${name}"...`);

  try {
    const result = await executePythonScript('enroll', {
      name,
      audio_path: expandedAudioPath,
      profiles_dir: profilesDir
    }, options);

    logger.success(LogCategory.PROCESSING,
      `Enrolled speaker "${name}" (${result.sample_duration_seconds?.toFixed(1) || '?'}s sample)`);

    return {
      success: true,
      profileId: result.profile_id,
      name: result.name,
      profilePath: result.profile_path,
      sampleDuration: result.sample_duration_seconds
    };
  } catch (error) {
    logger.failure(LogCategory.PROCESSING, `Failed to enroll speaker: ${error.message}`);
    throw error;
  }
}

/**
 * List all enrolled speaker profiles
 * @param {Object} options - List options
 * @returns {Promise<Object>} - List of profiles
 */
export async function listProfiles(options = {}) {
  const profilesDir = expandPath(
    options.profilesDir ||
    getConfigValue(config, 'speakerIdentification.profilesDir', '~/.summarai/profiles')
  );

  try {
    const result = await executePythonScript('list', {
      profiles_dir: profilesDir
    }, options);

    return {
      success: true,
      profiles: result.profiles,
      count: result.count
    };
  } catch (error) {
    // If profiles directory doesn't exist, return empty list
    if (error.errorType === 'file_not_found') {
      return {
        success: true,
        profiles: [],
        count: 0
      };
    }
    throw error;
  }
}

/**
 * Delete a speaker profile
 * @param {string} name - Profile name to delete
 * @param {Object} options - Delete options
 * @returns {Promise<Object>} - Deletion result
 */
export async function deleteProfile(name, options = {}) {
  const profilesDir = expandPath(
    options.profilesDir ||
    getConfigValue(config, 'speakerIdentification.profilesDir', '~/.summarai/profiles')
  );

  logger.processing(LogCategory.PROCESSING, `Deleting speaker profile "${name}"...`);

  try {
    const result = await executePythonScript('delete', {
      name,
      profiles_dir: profilesDir
    }, options);

    logger.success(LogCategory.PROCESSING, `Deleted speaker profile "${name}"`);

    return {
      success: true,
      deleted: result.deleted,
      profilePath: result.profile_path
    };
  } catch (error) {
    logger.failure(LogCategory.PROCESSING, `Failed to delete profile: ${error.message}`);
    throw error;
  }
}

/**
 * Identify speakers in transcript segments
 * @param {string} audioPath - Path to the audio file
 * @param {Array} segments - Transcript segments with speaker_id, start, end
 * @param {Object} options - Identification options
 * @returns {Promise<Object>} - Speaker mapping (speaker_id -> display_name)
 */
export async function identifySpeakers(audioPath, segments, options = {}) {
  const profilesDir = expandPath(
    options.profilesDir ||
    getConfigValue(config, 'speakerIdentification.profilesDir', '~/.summarai/profiles')
  );

  const threshold = options.threshold ||
    getConfigValue(config, 'speakerIdentification.threshold', 0.70);

  // Validate audio file exists
  const expandedAudioPath = expandPath(audioPath);
  if (!fs.existsSync(expandedAudioPath)) {
    throw new Error(`Audio file not found: ${expandedAudioPath}`);
  }

  // Convert segments to format expected by Python
  const pythonSegments = segments.map(seg => ({
    speaker_id: seg.speaker?.replace('Speaker ', 'speaker_') || seg.speaker_id,
    start: seg.start,
    end: seg.end,
    text: seg.text
  }));

  try {
    const result = await executePythonScript('identify', {
      audio_path: expandedAudioPath,
      segments: pythonSegments,
      profiles_dir: profilesDir,
      threshold
    }, options);

    // Log identification results
    const identified = Object.entries(result.speaker_mapping || {})
      .filter(([_, name]) => name !== null);

    if (identified.length > 0) {
      logger.info(LogCategory.PROCESSING,
        `Identified ${identified.length} speaker(s): ${identified.map(([_, n]) => n).join(', ')}`);
    }

    return result.speaker_mapping || {};
  } catch (error) {
    // Don't throw - speaker identification failures should not block transcription
    logger.warn(LogCategory.PROCESSING, `Speaker identification failed: ${error.message}`);
    return {};
  }
}

/**
 * Check if speaker identification is available and enabled
 * @returns {Promise<boolean>} - True if speaker ID can be used
 */
export async function isAvailable() {
  const enabled = getConfigValue(config, 'speakerIdentification.enabled', false);

  if (!enabled) {
    return false;
  }

  const envCheck = await checkPythonEnvironment(false);
  return envCheck.available;
}

/**
 * Identify speakers with graceful fallback
 * Never throws - returns empty mapping on any error
 * @param {string} audioPath - Path to audio file
 * @param {Array} segments - Transcript segments
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Speaker mapping or empty object
 */
export async function identifySpeakersWithFallback(audioPath, segments, options = {}) {
  try {
    const enabled = getConfigValue(config, 'speakerIdentification.enabled', false);

    if (!enabled) {
      return {};
    }

    return await identifySpeakers(audioPath, segments, options);
  } catch (error) {
    logger.warn(LogCategory.PROCESSING, `Speaker identification unavailable: ${error.message}`);
    return {};
  }
}
