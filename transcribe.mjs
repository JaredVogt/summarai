// Load environment variables first
import './env.mjs';

import axios from 'axios';
import os from 'os';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import { getLatestVoiceMemos } from './getLatestVoiceMemo.mjs';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { promisify } from 'util';
import { sendToClaude } from './claudeAPI.mjs';
import { transcribeWithWhisper } from './whisperAPI.mjs';
import { transcribeWithScribe, createSegmentsContent } from './scribeAPI.mjs';
import { convertToTempAAC, cleanupTempDir, splitAudioFile } from './audioProcessing.mjs';
import { startSpinner, sanitizeFilename } from './utils.mjs';
import { loadConfig, getConfigValue } from './configLoader.mjs';
import { appendRecord, loadIndex } from './src/processHistory.mjs';
import {
  ProcessingError,
  FileSystemError,
  handleError,
  withErrorHandling
} from './src/errors.mjs';
import {
  validateFilePath,
  validateAudioOptions,
  validateTranscriptionOptions,
  validateFileSize,
  validateFileIntegrity
} from './src/validation.mjs';
import logger, { LogCategory, LogStatus } from './src/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
let config;
try {
  config = loadConfig();
} catch (error) {
  logger.warn(LogCategory.CONFIG, `Could not load config, using fallback values: ${error.message}`);
  config = { directories: { output: './output' } };
}

const OUTPUT_DIR = getConfigValue(config, 'directories.output', './output');

// History is now tracked via NDJSON (see src/processHistory.mjs)

async function transcribeLatestVoiceMemo(transcriptionService) {
  const rl = readline.createInterface({ input, output });
  let count = 1;
  try {
    const answer = await rl.question('How many recent voice memos would you like to see? ');
    count = Math.max(1, parseInt(answer, 10) || 1);
  } catch {
    count = 1;
  }
  
  let files = [];
  try {
    files = await getLatestVoiceMemos(count);
  } catch (err) {
    logger.failure(LogCategory.PROCESSING, `Error finding voice memos: ${err.message}`);
    rl.close();
    return;
  }
  // Get processed filenames (original basenames)
  const { bySourceName: processed } = loadIndex(config);
  logger.info(LogCategory.PROCESSING, 'Recent Voice Memos:');
  for (let i = 0; i < files.length; i++) {
    const { file, duration, date, gps } = files[i];
    let info = [];
    // Remove 'sec' and whitespace, then format as mins:secs if numeric
    let formattedDuration = duration;
    if (duration) {
      const secMatch = duration.replace(/sec.*$/i, '').trim();
      if (/^\d+(\.\d+)?$/.test(secMatch)) {
        const totalSecs = Math.round(parseFloat(secMatch));
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        formattedDuration = `${mins}:${secs.toString().padStart(2, '0')}`;
      }
    }
    if (formattedDuration) info.push(`duration: ${formattedDuration}`);
    if (date) info.push(`date: ${date}`);
    if (gps) info.push(`gps: ${gps}`);
    const originalFileName = path.basename(file);
    const isProcessed = processed.has(originalFileName);
    console.log(`${i + 1}. ${file}${info.length ? ' (' + info.join(', ') + ')' : ''}${isProcessed ? ' (Processed)' : ''}`);
  }

  let selected = 0;
  try {
    const sel = await rl.question('Select a file to transcribe (number), or type "all" to re-process all: ');
    if (sel.toLowerCase() === 'all') {
      // Re-process all files
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const originalFileName = path.basename(file.file);
        const isProcessed = processed.has(originalFileName);
        if (isProcessed) {
          logger.info(LogCategory.PROCESSING, `Re-processing: ${file.file}`);
        } else {
          logger.info(LogCategory.PROCESSING, `Processing: ${file.file}`);
        }
        await processVoiceMemo(file.fullPath, { transcriptionService });
      }
      rl.close();
      return;
    }
    selected = Math.max(1, Math.min(files.length, parseInt(sel, 10) || 1)) - 1;
  } catch {
    selected = 0;
  }
  rl.close();
  
  // Process the selected file using processVoiceMemo
  await processVoiceMemo(files[selected].fullPath, { transcriptionService });
}

// Exportable main workflow for automation
export async function processVoiceMemo(filePath, options = {}) {
  const {
    forceVideoMode = false,
    lowQuality = false,
    transcriptionService = 'scribe',
    silentMode = false,
    model = null,
    maxSpeakers = null,
    fromGoogleDrive = false,
    outputPath = null,
    createSegmentsFile = null  // Allow override, but default to config value
  } = options;

  // Always have a safe filename available for logging/error context,
  // even if validation fails before we compute a validatedPath.
  const safeOriginalForContext = (() => {
    try { return path.basename(filePath || ''); } catch { return 'unknown'; }
  })();

  // Get the global setting from config, with fallback to true for backward compatibility
  const globalCreateSegmentsFile = getConfigValue(config, 'fileProcessing.output.createSegmentsFile', true);
  const shouldCreateSegmentsFile = createSegmentsFile !== null ? createSegmentsFile : globalCreateSegmentsFile;

  let usedTemp = false; // Initialize outside try block for error handling
  let tempDir; // Initialize outside try block for error handling

  // Debug Google Drive flag
  if (fromGoogleDrive) {
    logger.info(LogCategory.PROCESSING, `Processing Google Drive file: ${path.basename(filePath)}`);
  }

  try {
    // Validate inputs
    const validatedPath = validateFilePath(filePath, true);
    const validatedAudioOptions = validateAudioOptions({ lowQuality });
    const validatedTranscriptionOptions = validateTranscriptionOptions({
      transcriptionService,
      model,
      maxSpeakers
    });

    // Validate file size
    validateFileSize(validatedPath, 1024); // 1GB limit

    // Get validation configuration
    const validationEnabled = getConfigValue(config, 'watch.validation.enabled', true);
    const validationLevel = getConfigValue(config, 'watch.validation.level', 'moov');
    const minFileSize = getConfigValue(config, 'watch.validation.minFileSize', 1024);

    // Check minimum file size
    const stats = fs.statSync(validatedPath);
    if (stats.size < minFileSize) {
      throw new ValidationError(
        `File size ${stats.size} bytes is below minimum of ${minFileSize} bytes`,
        'fileSize'
      );
    }

    // Validate file integrity if enabled
    if (validationEnabled) {
      logger.info(LogCategory.PROCESSING, `Validating file integrity (${validationLevel} level)...`);
      await validateFileIntegrity(validatedPath, validationLevel);
      logger.success(LogCategory.PROCESSING, 'File validation passed');
    }

    const originalFileName = path.basename(validatedPath);
    let recordingDateTime = null;
    let recordingDateTimePrefix = null;

    // Try to extract date/time from filename pattern (common for voice memos)
    // Support both YYYYMMDD_HHMMSS and YYMMDD_HHMM formats
    let dtMatch = originalFileName.match(/(\d{8})[ _-](\d{6})/); // YYYYMMDD_HHMMSS
    let isShortFormat = false;

    if (!dtMatch) {
      dtMatch = originalFileName.match(/(\d{6})[ _-](\d{4})/); // YYMMDD_HHMM
      isShortFormat = true;
    }

    if (dtMatch) {
      const [_, dateStr, timeStr] = dtMatch;

      let year, month, day, hour, min, sec;

      if (isShortFormat) {
        // YYMMDD_HHMM format
        const yyStr = dateStr.slice(0, 2);
        month = dateStr.slice(2, 4);
        day = dateStr.slice(4, 6);
        hour = timeStr.slice(0, 2);
        min = timeStr.slice(2, 4);
        sec = '00'; // Default to 00 seconds

        // Convert 2-digit year to 4-digit (assuming 20XX for now)
        const yy = parseInt(yyStr, 10);
        year = yy < 50 ? `20${yyStr}` : `19${yyStr}`;
      } else {
        // YYYYMMDD_HHMMSS format
        year = dateStr.slice(0, 4);
        month = dateStr.slice(4, 6);
        day = dateStr.slice(6, 8);
        hour = timeStr.slice(0, 2);
        min = timeStr.slice(2, 4);
        sec = timeStr.slice(4, 6);
      }

      recordingDateTimePrefix = `${year}${month}${day}_${hour}${min}${sec}`;
      recordingDateTime = `${year}-${month}-${day}T${hour}:${min}:${sec}-07:00`;
    } else {
      // For files without timestamp in name, get the current time
      console.log('No datetime pattern found in filename, using current time');
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hour = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const sec = String(now.getSeconds()).padStart(2, '0');

      // Format for display and filename
      recordingDateTimePrefix = `${year}${month}${day}_${hour}${min}${sec}`;
      recordingDateTime = now.toISOString();
    }

    // Always convert to temp AAC
    // For Google Drive files, use a temp directory that can be accessed later
    tempDir = fromGoogleDrive
      ? path.join(path.dirname(filePath), 'temp')
      : path.join(os.tmpdir(), 'summarai_temp', path.basename(filePath, path.extname(filePath)));

    const tempAACPath = await convertToTempAAC(filePath, tempDir, {
      forceAudioExtraction: forceVideoMode,
      lowQuality: lowQuality
    });
    usedTemp = true;
    logger.processing(LogCategory.PROCESSING, `Processing file: ${originalFileName}`);
    // Get file size for logging
    const tempStats = fs.statSync(tempAACPath);
    const fileSizeMB = tempStats.size / (1024 * 1024);

    logger.info(LogCategory.PROCESSING, `Using transcription service: ${transcriptionService === 'whisper' ? 'OpenAI Whisper' : 'ElevenLabs Scribe'}`);
    
    let transcriptionData;
    let transcript;
    let segmentsContent;
    let usedModel = null;
    
    if (transcriptionService === 'whisper') {
      // Whisper has a 25MB file size limit
      const maxSizeMB = 22; // 22MB practical limit for Whisper API
      let audioPathsToProcess;
      const chunksDir = path.join(tempDir, 'chunks');
      
      if (fileSizeMB > maxSizeMB) {
        console.log(`Audio file size (${fileSizeMB.toFixed(2)} MB) exceeds Whisper API limit of ${maxSizeMB} MB`);
        // Split the audio file into chunks
        audioPathsToProcess = await splitAudioFile(tempAACPath, chunksDir, maxSizeMB);
        console.log(`Split audio into ${audioPathsToProcess.length} chunks for processing`);
      } else {
        audioPathsToProcess = [tempAACPath];
        console.log(`Audio file size (${fileSizeMB.toFixed(2)} MB) is under the limit, processing as a single file`);
      }
      
      // Use verbose mode to get timestamps and detailed JSON
      transcriptionData = await transcribeWithWhisper(audioPathsToProcess, true);
      
      // Extract the text transcript from the response
      transcript = transcriptionData.text;
      // Record model used for logging
      usedModel = getConfigValue(config, 'transcription.whisper.model', 'whisper-1');
      
      // Create a timestamped segments text with lowercase heading
      segmentsContent = "## transcription with timestamps\n";
      if (transcriptionData.segments && Array.isArray(transcriptionData.segments)) {
        transcriptionData.segments.forEach((segment, i) => {
          const startTime = formatTimestamp(segment.start);
          const endTime = formatTimestamp(segment.end);
          segmentsContent += `[${startTime} - ${endTime}] ${segment.text}\n`;
        });
      }
    } else {
      // ElevenLabs Scribe can handle files up to 1GB
      logger.info(LogCategory.PROCESSING, `Audio file size (${fileSizeMB.toFixed(2)} MB) - ElevenLabs Scribe can handle up to 1GB`);
      
      // Get default values from config
      const defaultModel = getConfigValue(config, 'transcription.scribe.model', 'scribe_v1');
      const defaultMaxSpeakers = getConfigValue(config, 'transcription.scribe.maxSpeakers', null);
      
      // Use parameters if provided, otherwise use config defaults
      let selectedModel = model || defaultModel;
      let selectedMaxSpeakers = maxSpeakers !== undefined ? maxSpeakers : defaultMaxSpeakers;
      
      if (!silentMode && !model && maxSpeakers === undefined) {
        // Only prompt if user hasn't specified parameters and not in silent mode
        const rl = readline.createInterface({ input, output });
        
        const speakersDisplay = selectedMaxSpeakers ? `max ${selectedMaxSpeakers}` : 'auto';
        try {
          const overrideAnswer = await rl.question(`Use config defaults (${selectedModel}, ${speakersDisplay} speakers)? [Y/n]: `);
          
          if (overrideAnswer.toLowerCase() === 'n' || overrideAnswer.toLowerCase() === 'no') {
            // User wants to override - ask for custom values
            try {
              const modelAnswer = await rl.question('Which Scribe model would you like to use? (1: scribe_v1, 2: scribe_v1_experimental) [current: ' + (selectedModel === 'scribe_v1_experimental' ? '2' : '1') + ']: ');
              if (modelAnswer === '2') {
                selectedModel = 'scribe_v1_experimental';
              } else if (modelAnswer === '1') {
                selectedModel = 'scribe_v1';
              }
              // If no answer, keep current value
            } catch {
              // Use current value
            }
            
            try {
              const speakersAnswer = await rl.question(`Maximum number of speakers to detect [current: ${speakersDisplay}]: `);
              if (speakersAnswer.toLowerCase() === 'auto' || speakersAnswer === '') {
                selectedMaxSpeakers = null;
              } else {
                const speakersNum = parseInt(speakersAnswer, 10);
                if (!isNaN(speakersNum) && speakersNum > 0 && speakersNum <= 32) {
                  selectedMaxSpeakers = speakersNum;
                }
              }
            } catch {
              // Use current value
            }
          }
        } catch {
          // Use defaults
        }
        rl.close();
      } else if (!silentMode) {
        const speakersDisplay = selectedMaxSpeakers ? `max ${selectedMaxSpeakers}` : 'auto';
        logger.info(LogCategory.PROCESSING, `Using specified settings: ${selectedModel}, ${speakersDisplay} speakers`);
      } else {
        const speakersDisplay = selectedMaxSpeakers ? `max ${selectedMaxSpeakers}` : 'auto';
        logger.info(LogCategory.PROCESSING, `Silent mode: Using ${selectedModel} with ${speakersDisplay} speaker detection`);
      }
      
      // Get diarize setting from config
      const diarizeSetting = getConfigValue(config, 'transcription.scribe.diarize', true);
      
      // Use ElevenLabs Scribe for transcription
      transcriptionData = await transcribeWithScribe(tempAACPath, {
        model: selectedModel,
        maxSpeakers: selectedMaxSpeakers,
        diarize: diarizeSetting,
        tagAudioEvents: true,
        verbose: true
      });
      
      // Extract the text transcript
      transcript = transcriptionData.text;
      
      // Create segments content using the helper function
      segmentsContent = createSegmentsContent(transcriptionData);
      // Record model used for logging
      usedModel = selectedModel;
    }
    
    // Don't print the full transcript to console to reduce output verbosity
    logger.success(LogCategory.PROCESSING, 'Transcription processed successfully');
    // Just show transcript length as indicator
    logger.info(LogCategory.PROCESSING, `Transcript length: ${transcript.length} characters, ${transcript.split(/\s+/).length} words`);
  
    // Send to Claude and write output (markdown + audio)
    // Pass the original filePath for metadata, but tempAACPath for copying the actual file
    const { finalName, targetDir, mdFilePath } = await sendToClaude(transcript, filePath, recordingDateTimePrefix, recordingDateTime, outputPath || OUTPUT_DIR, originalFileName, tempAACPath);
    
    // Write segments to a file (only if enabled by config or override)
    if (shouldCreateSegmentsFile) {
      const segmentsFile = path.join(targetDir, `${finalName}_segments.txt`);
      fs.writeFileSync(segmentsFile, segmentsContent);
      console.log(`Segments with timestamps written to: ${segmentsFile}`);
    }
    
    // Append segments to the markdown file
    if (mdFilePath && fs.existsSync(mdFilePath)) {
      fs.appendFileSync(mdFilePath, '\n\n' + segmentsContent);
      console.log(`Timestamps appended to markdown file: ${mdFilePath}`);
    }
  
    // Append NDJSON record for processed file (source-based)
    try {
      const sourceStats = fs.statSync(validatedPath);
      appendRecord(config, {
        processedAt: recordingDateTime || new Date().toISOString(),
        sourcePath: validatedPath,
        sourceName: originalFileName,
        destAudioPath: null,
        outputMdPath: mdFilePath || null,
        service: transcriptionService,
        model: usedModel,
        sizeSourceBytes: sourceStats?.size ?? null,
        sizeDestBytes: null
      });
    } catch {}
    
    // If from Google Drive, return the compressed file path for moving
    if (fromGoogleDrive && usedTemp) {
      // Validate that the compressed file exists before returning it
      if (!fs.existsSync(tempAACPath)) {
        logger.failure(LogCategory.PROCESSING, `Compressed file not found at expected path: ${tempAACPath}`);
        throw new ProcessingError(
          `Google Drive file processing failed: compressed file not found`,
          { filePath, tempAACPath }
        );
      }

      logger.info(LogCategory.PROCESSING, `Google Drive file processed: returning compressed path for moving`);
      logger.debug(LogCategory.PROCESSING, `Compressed AAC path: ${tempAACPath}`);

      return {
        finalName,
        targetDir,
        transcript,
        segmentsContent,
        mdFilePath,
        compressedPath: tempAACPath,
        tempDir: tempDir // Return tempDir so caller can clean it up after moving
      };
    } else {
      // For non-Google Drive files, clean up temp as usual
      if (!fromGoogleDrive) {
        logger.debug(LogCategory.PROCESSING, `Non-Google Drive file: cleaning up temp files`);
      } else {
        logger.warning(LogCategory.PROCESSING, `Google Drive file but no temp used - compression may have failed`);
      }
      if (usedTemp) cleanupTempDir(tempDir);
      return { finalName, targetDir, transcript, segmentsContent, mdFilePath };
    }
  } catch (error) {
    // Always clean up on error
    if (usedTemp) cleanupTempDir(tempDir);

    // Handle different types of errors appropriately
    // Use a precomputed, safe fallback so we don't throw ReferenceError
    const context = `processVoiceMemo(${safeOriginalForContext})`;

    if (error.code === 'ENOENT') {
      throw new FileSystemError('File not found', 'read', filePath, { originalError: error });
    } else if (error.code === 'EACCES') {
      throw new FileSystemError('Permission denied', 'access', filePath, { originalError: error });
    } else if (error.name === 'ValidationError') {
      // Re-throw validation errors as-is
      throw error;
    } else if (error.stderr && (error.stderr.includes('moov atom not found') || 
                               error.stderr.includes('Invalid data found'))) {
      // Handle ffmpeg/ffprobe moov atom errors specifically
      throw new ValidationError(
        'File appears to be incomplete or corrupted (moov atom missing or invalid data)',
        'fileIntegrity',
        { originalError: error }
      );
    } else {
      // Check for other processing-related errors that might be retryable
      const errorMessage = error.message || error.stderr || String(error);
      const isFileIntegrityError = errorMessage.includes('moov atom') || 
                                   errorMessage.includes('corrupted') || 
                                   errorMessage.includes('incomplete') ||
                                   errorMessage.includes('Invalid data found');
      
      if (isFileIntegrityError) {
        throw new ValidationError(
          `File integrity issue detected: ${errorMessage}`,
          'fileIntegrity',
          { originalError: error }
        );
      }
      
      // Wrap other errors as processing errors
      throw new ProcessingError(
        `Failed to process voice memo: ${errorMessage}`,
        { filePath, originalError: error.message, context }
      );
    }
  }
}

/**
 * Formats seconds to a readable timestamp format (MM:SS.ms)
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted timestamp
 */
function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// Parse command line arguments to check for a directly specified file and options
function parseCommandLineArgs() {
  const args = process.argv.slice(2);

  // Default values
  const result = {
    filePath: null,
    forceVideoMode: false,
    lowQuality: false,
    transcriptionService: 'scribe',
    silentMode: false,
    displayHelp: false
  };

  // First check for silent mode before processing other flags
  if (args.includes('--silent')) {
    result.silentMode = true;
    logger.info(LogCategory.PROCESSING, 'Silent mode enabled: auto-processing newest unprocessed voice memo');
  }

  // Process each argument
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.displayHelp = true;
    } else if (arg === '--video' || arg === '-v') {
      result.forceVideoMode = true;
      if (!result.silentMode) logger.info(LogCategory.PROCESSING, 'Video mode enabled: will force audio extraction');
    } else if (arg === '--low-quality' || arg === '-l') {
      result.lowQuality = true;
      if (!result.silentMode) logger.info(LogCategory.PROCESSING, 'Low quality mode enabled: will use more aggressive compression');
    } else if (arg === '--scribe' || arg === '-s') {
      result.transcriptionService = 'scribe';
      if (!result.silentMode) logger.info(LogCategory.PROCESSING, 'Using ElevenLabs Scribe for transcription');
    } else if (arg === '--whisper' || arg === '-w') {
      result.transcriptionService = 'whisper';
      if (!result.silentMode) logger.info(LogCategory.PROCESSING, 'Using OpenAI Whisper for transcription');
    } else if (arg === '--silent') {
      // Already handled above
    } else if (!arg.startsWith('-') && !result.filePath) {
      result.filePath = arg;
    }
  }

  if (result.displayHelp) {
    showHelp();
    process.exit(0);
  }

  // Convert relative path to absolute if needed
  if (result.filePath && !path.isAbsolute(result.filePath)) {
    result.filePath = path.resolve(process.cwd(), result.filePath);
  }

  // Verify file exists if a filePath is provided
  if (result.filePath && !fs.existsSync(result.filePath)) {
    logger.failure(LogCategory.PROCESSING, `File not found: ${result.filePath}`);
    process.exit(1);
  }

  return result;
}

// Display help information
function showHelp() {
  console.log(`
Voice Memo Transcription Tool

Usage: node transcribe.mjs [options] [file]

Options:
  --help, -h          Show this help message
  --video, -v         Force video mode (extract audio from video)
  --low-quality, -l   Use more aggressive compression for larger files
  --whisper, -w       Use OpenAI Whisper for transcription
  --scribe, -s        Use ElevenLabs Scribe for transcription (default)
  --silent            Silent mode: auto-process newest unprocessed voice memo

Examples:
  node transcribe.mjs                            # Interactive mode
  node transcribe.mjs ~/Downloads/recording.m4a  # Process specific file
  node transcribe.mjs --video ~/Downloads/video.mp4  # Process video file
  node transcribe.mjs --whisper recording.m4a    # Use Whisper API
  node transcribe.mjs --scribe recording.m4a     # Use Scribe API
  node transcribe.mjs --silent                   # Auto-process in silent mode
`);
}

/**
 * Get the newest voice memo that hasn't been processed yet
 * @returns {Promise<string|null>} - Path to the newest unprocessed voice memo, or null if all are processed
 */
async function getLatestUnprocessedVoiceMemo() {
  try {
  // Get processed filenames
  const { bySourceName: processed } = loadIndex(config);
    
    // Get recent voice memos (up to 100 as requested by user)
    const files = await getLatestVoiceMemos(100);
    
    // Find the first unprocessed file
    for (const file of files) {
      const originalFileName = path.basename(file.file);
      if (!processed.has(originalFileName)) {
        logger.info(LogCategory.PROCESSING, `Found unprocessed voice memo: ${file.file}`);
        return file.fullPath;
      }
    }
    
    console.log('No unprocessed voice memos found.');
    return null;
  } catch (err) {
    console.error('Error finding unprocessed voice memo:', err.message);
    return null;
  }
}

/**
 * Process voice memo in silent mode with predefined options
 * @param {string} filePath - Path to the audio file
 * @returns {Promise<void>}
 */
async function processInSilentMode(filePath) {
  if (!filePath) {
    logger.failure(LogCategory.PROCESSING, 'No unprocessed voice memo found');
    return;
  }
  
  // Use Scribe with model 1 (scribe_v1) and auto voice detection
  const options = {
    transcriptionService: 'scribe',
    forceVideoMode: false,
    lowQuality: false,
    silentMode: true,      // Add the silent mode flag to bypass prompts
    model: 'scribe_v1',    // Model 1 as specified in requirements
    maxSpeakers: null      // Auto voice detection as specified in requirements
  };
  
  logger.info(LogCategory.PROCESSING, `Silent mode: Processing file ${filePath} with model 1 and auto voice detection`);
  try {
    await processVoiceMemo(filePath, options);
    logger.success(LogCategory.PROCESSING, 'Silent mode processing completed successfully');
  } catch (error) {
    logger.failure(LogCategory.PROCESSING, `Error during silent mode processing: ${error.message}`);
  }
}

// Run if called directly (but not when imported by summarai or running in executable)
// Check for both 'watchDirectories' (backwards compatibility) and 'summarai' (current name)
if (import.meta.url === `file://${process.argv[1]}` &&
    !process.argv[1]?.includes('watchDirectories') &&
    !process.argv[1]?.includes('summarai') &&
    !process.argv[1]?.includes('release/summarai')) {
  const parsedArgs = parseCommandLineArgs(); // This will exit if --help is passed
  
  // The order of checks is important - silent mode takes highest precedence
  if (parsedArgs.silentMode === true) {
    logger.info(LogCategory.PROCESSING, 'Running in silent mode - will auto-process the newest unprocessed voice memo');
    // Silent mode - auto process the newest unprocessed voice memo
    getLatestUnprocessedVoiceMemo()
      .then(filePath => {
        if (filePath) {
          return processInSilentMode(filePath);
        } else {
          logger.info(LogCategory.PROCESSING, 'No unprocessed voice memos found');
        }
      })
      .catch(err => {
        logger.failure(LogCategory.PROCESSING, `Error in silent mode: ${err.message}`);
      });
  } else if (parsedArgs.filePath) {
    // Direct file processing mode
    logger.info(LogCategory.PROCESSING, `Processing file: ${parsedArgs.filePath}`);
    processVoiceMemo(parsedArgs.filePath, {
      forceVideoMode: parsedArgs.forceVideoMode,
      lowQuality: parsedArgs.lowQuality,
      transcriptionService: parsedArgs.transcriptionService
    });
  } else {
    // Interactive mode (no file path provided)
    transcribeLatestVoiceMemo(parsedArgs.transcriptionService);
  }
}

export { transcribeLatestVoiceMemo, getLatestUnprocessedVoiceMemo, processInSilentMode };
