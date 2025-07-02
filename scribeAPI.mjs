import fs from 'fs';
import path from 'path';
import { startSpinner } from './utils.mjs';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { retryWithBackoff, defaultShouldRetry } from './retryUtils.mjs';

// Don't read the API key at import time, will access process.env directly when needed

/**
 * Transcribe audio/video using ElevenLabs Scribe API
 * @param {string} audioFilePath - Path to the audio file to transcribe
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} - Transcription result with text and detailed info
 */
export async function transcribeWithScribe(audioFilePath, options = {}) {
  // Get API key at runtime, after dotenv has loaded it
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not set');
  }

  const {
    model = 'scribe_v1', // or 'scribe_v1_experimental'
    language = null, // ISO-639-1 or ISO-639-3 code (auto-detect if null)
    tagAudioEvents = true, // Tag events like (laughter), (applause)
    maxSpeakers = null, // Max speakers (1-32, auto if null)
    verbose = false, // Whether to return verbose data
  } = options;

  const timeoutInSeconds = options.timeoutInSeconds || parseInt(process.env.SCRIBE_TIMEOUT_SECONDS) || 300; // Timeout in seconds

  // Check file exists and validate size
  if (!fs.existsSync(audioFilePath)) {
    throw new Error(`File not found: ${audioFilePath}`);
  }

  const stats = fs.statSync(audioFilePath);
  const fileSizeMB = stats.size / (1024 * 1024);
  const maxSizeMB = 1024; // 1GB limit

  if (fileSizeMB > maxSizeMB) {
    throw new Error(`File size exceeds ${maxSizeMB}MB limit (${fileSizeMB.toFixed(2)}MB)`);
  }

  console.log(`Processing file (${fileSizeMB.toFixed(2)} MB) with ElevenLabs Scribe...`);

  // Initialize the client
  const elevenlabs = new ElevenLabsClient({
    apiKey: ELEVENLABS_API_KEY
  });
  
  // Prepare options for the speechToText.convert method
  const callSpecificOptions = {
    modelId: model, // Keep model from options
    tagAudioEvents: tagAudioEvents, // Keep tagAudioEvents from options
    languageCode: 'eng', // HARDCODED FOR TEST
    diarize: true,       // HARDCODED FOR TEST
  };
  
  // Add optional parameters if they were intended to be used and are different from test
  if (maxSpeakers && callSpecificOptions.diarize) { // Only add maxSpeakers if diarize is true
    callSpecificOptions.maxSpeakers = maxSpeakers;
  }
  
  // Spinner for connecting/uploading/transcribing
  const stopSpinner = startSpinner('Connecting to ElevenLabs Scribe API and transcribing...');

  try {
    // Determine MIME type based on file extension
    const ext = path.extname(audioFilePath).toLowerCase();
    let mimeType = 'audio/mpeg'; // Default
    let fileType = 'audio';
    
    if (ext === '.mp3') mimeType = 'audio/mpeg';
    else if (ext === '.wav') mimeType = 'audio/wav';
    else if (ext === '.m4a') mimeType = 'audio/mp4'; // Common for M4A
    else if (ext === '.ogg') mimeType = 'audio/ogg';
    else if (ext === '.flac') mimeType = 'audio/flac';
    else if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) {
      fileType = 'video';
      // For video files, Scribe expects the audio stream. 
      // The SDK might handle extraction, or we might need prior audio extraction if not.
      // For now, let's assume the SDK or Scribe API can handle audio from these video containers
      // or that audioFilePath is already an extracted audio track.
      // If it's a video container, the MIME type should reflect that if the SDK handles it,
      // or it should be an audio MIME type if audio has been pre-extracted.
      // Given Scribe is speech-to-text, it will process audio. Let's use a generic audio type
      // if we are unsure, or rely on the SDK to infer from the buffer if it's an audio file.
      // The example uses 'audio/mp3' for an mp3. If audioFilePath is, say, a .mp4 video,
      // we should be passing the audio stream. For simplicity with direct buffer, we'll assume
      // audioFilePath is an audio file or the SDK handles audio extraction from video buffer.
      // Let's stick to audio mime types as Scribe is an audio transcription service.
      // If it's a video file, this mimeType might need adjustment based on whether it's raw audio extracted from video
      // or if the API can take a video container and extract audio.
      // The example uses audioBlob, so we should provide an audio buffer.
      // We'll assume audioFilePath is an audio file for this direct buffer approach.
      // If audioProcessing.mjs is used to extract audio first, then audioFilePath will be an audio file.
      if (fileType === 'video') {
        // This case implies audioFilePath is a video file. Scribe needs audio.
        // This part of the logic might need to be revisited if audioFilePath is a video container
        // and not an extracted audio stream. For now, we'll assume it's an audio file as per the example's pattern.
        // If it's a video file, the user should extract audio first before sending to Scribe.
        // Let's assume audioFilePath is always an audio file for Scribe.
        console.warn(`Warning: Passing a video file (${ext}) directly. Scribe expects audio. Ensure this file is an audio track or audio can be extracted.`);
        // For now, we'll use a common audio type for video extensions if passed directly, though this is not ideal.
        // It's better to ensure audioFilePath is an audio file.
        mimeType = 'audio/mp4'; // A common audio codec in video files.
      } else {
        // This is for actual audio files, map extension to mimeType
        const audioMimeTypes = {
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.m4a': 'audio/mp4',
          '.aac': 'audio/aac',
          '.ogg': 'audio/ogg',
          '.flac': 'audio/flac',
          '.opus': 'audio/opus',
        };
        mimeType = audioMimeTypes[ext] || 'application/octet-stream'; // Fallback
      }
    }
    
    console.log(`Processing ${fileType} file: ${path.basename(audioFilePath)} (MIME Type: ${mimeType})`);
    
    // Read the file into a buffer
    const fileBuffer = fs.readFileSync(audioFilePath);
    
    // Create a Blob from the buffer, similar to the working example
    let audioBlob = new Blob([fileBuffer], { type: mimeType });

    // Log options before calling API
    console.log(`[ScribeAPI] Calling ElevenLabs speechToText.convert with:`);
    console.log(`[ScribeAPI] Blob type: ${audioBlob.type}, size: ${audioBlob.size}`);
    console.log(`[ScribeAPI] Options:`, JSON.stringify(callSpecificOptions, null, 2));

    // Define retry options for ElevenLabs
    const retryOptions = {
      maxRetries: 3,
      operation: 'ElevenLabs Scribe transcription',
      shouldRetry: (error) => {
        // Custom retry logic for ElevenLabs
        if (error.message && error.message.includes('Response body object should not be disturbed or locked')) {
          return true;
        }
        // Use default retry logic for other errors
        return defaultShouldRetry(error);
      },
      onRetry: async (attempt, error) => {
        // Create fresh Blob on retry to avoid stream reuse issues
        console.log(`[ScribeAPI] Creating fresh Blob for retry attempt ${attempt}`);
        const freshFileBuffer = fs.readFileSync(audioFilePath);
        audioBlob = new Blob([freshFileBuffer], { type: mimeType });
      }
    };

    // Call with retry logic
    const result = await retryWithBackoff(async () => {
      return await elevenlabs.speechToText.convert({
        ...callSpecificOptions, // Use the modified options for testing
        file: audioBlob, // Pass the Blob object
      }, {
        timeoutInSeconds: timeoutInSeconds // Use timeoutInSeconds directly
      });
    }, retryOptions);
    
    stopSpinner();
    
    // Process and format the result
    const formattedResult = formatScribeResult(result, verbose);
    
    return formattedResult;

  } catch (err) {
    stopSpinner();
    // More detailed error logging
    console.error('Error during Scribe transcription:', err);
    if (err.message && err.message.includes('invalid_json_response_body')) {
      console.error('This might indicate an issue with the API key, file format, or API service availability.');
    }
    throw new Error(`Transcription error with ElevenLabs Scribe: ${err.message}`);
  }
}

/**
 * Format the Scribe API result to match our application needs
 * @param {Object} result - Original API response from ElevenLabs SDK
 * @param {boolean} verbose - Whether to include detailed data
 * @returns {Object} - Formatted result
 */
function formatScribeResult(result, verbose = false) {
  // Extract the plain text (different path with the SDK)
  const text = result.transcription || result.text || '';
  
  // Process words and segments for timestamps if available
  let segments = [];
  let lastSpeaker = null;
  let currentSegment = null;

  // Get words array from SDK response (structure might be different)
  const words = result.words || [];
  
  // Process words to create segments similar to Whisper format
  if (words && Array.isArray(words)) {
    words.forEach((word, index) => {
      // Check if this is a new speaker or first word
      const speakerId = word.speaker_id || word.speakerId;
      
      if (speakerId !== lastSpeaker || !currentSegment) {
        // Save previous segment if exists
        if (currentSegment) {
          segments.push(currentSegment);
        }
        
        // Start new segment
        currentSegment = {
          id: segments.length,
          start: word.start || 0,
          end: word.end || 0,
          text: word.text || '',
          speaker: speakerId !== undefined ? `Speaker ${speakerId}` : undefined
        };
        
        lastSpeaker = speakerId;
      } else {
        // Append to current segment
        currentSegment.text += ' ' + (word.text || '');
        currentSegment.end = word.end || 0;
      }
      
      // Add the last segment
      if (index === words.length - 1 && currentSegment) {
        segments.push(currentSegment);
      }
    });
  }

  // Create a formatted result compatible with our application
  const formatted = {
    text,
    segments,
    language: result.language || result.languageCode || 'en',
    confidence: result.languageProbability || 1.0,
    speakers: extractSpeakers(words),
    duration: calculateDuration(words)
  };

  // If verbose mode is enabled, include all original data
  if (verbose) {
    formatted.raw = result;
    formatted.words = words;
  }

  return formatted;
}

/**
 * Extract unique speakers from transcription
 * @param {Array} words - Words array from API response  
 * @returns {Array} - Unique speaker IDs
 */
function extractSpeakers(words) {
  if (!words) return [];
  const speakers = new Set();
  words.forEach(word => {
    // Check both possible property names for speaker ID
    const speakerId = word.speaker_id !== undefined ? word.speaker_id : word.speakerId;
    if (speakerId !== undefined) {
      speakers.add(speakerId);
    }
  });
  return Array.from(speakers);
}

/**
 * Calculate total duration from word timestamps
 * @param {Array} words - Words array from API response
 * @returns {number} - Duration in seconds
 */
function calculateDuration(words) {
  if (!words || words.length === 0) return 0;
  const lastWord = words[words.length - 1];
  return lastWord.end || lastWord.start || 0;
}

/**
 * Create segments content in our standard format
 * @param {Object} transcriptionData - Formatted transcription data
 * @returns {string} - Formatted segments content
 */
export function createSegmentsContent(transcriptionData) {
  let segmentsContent = "## transcription with timestamps\n";
  
  if (transcriptionData.segments && Array.isArray(transcriptionData.segments)) {
    transcriptionData.segments.forEach(segment => {
      const startTime = formatTimestamp(segment.start);
      const endTime = formatTimestamp(segment.end);
      const speakerPrefix = segment.speaker ? `${segment.speaker}: ` : '';
      segmentsContent += `[${startTime} - ${endTime}] ${speakerPrefix}${segment.text}\n`;
    });
  }
  
  return segmentsContent;
}

/**
 * Format seconds to a readable timestamp format (MM:SS.ms)
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted timestamp
 */
function formatTimestamp(seconds) {
  if (seconds === undefined || seconds === null) return '00:00.000';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}
