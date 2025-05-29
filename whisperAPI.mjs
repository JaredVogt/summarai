import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { startSpinner } from './utils.mjs';

// Don't read the API key at import time, will access process.env directly when needed

/**
 * Gets nomenclature prompt to help Whisper with domain-specific terms
 * @returns {string} - Nomenclature prompt text
 */
export function getNomenclaturePrompt() {
  try {
    const terms = fs.readFileSync('./nomenclature.txt', 'utf8').trim();
    if (!terms) return '';
    return `The transcript may include these specific terms: ${terms.split(/\r?\n/).join(', ')}`;
  } catch {
    return '';
  }
}

/**
 * Transcribes audio using OpenAI's Whisper API
 * @param {string} audioFilePath - Path to the audio file to transcribe
 * @param {boolean} [verbose=false] - Whether to return verbose JSON with timestamps
 * @returns {Promise<string|Object>} - Transcription text or full JSON response with timestamps
 */
/**
 * Transcribes a single audio file using OpenAI's Whisper API
 * @param {string} audioFilePath - Path to the audio file to transcribe
 * @param {boolean} [verbose=false] - Whether to return verbose JSON with timestamps
 * @returns {Promise<string|Object>} - Transcription text or full JSON response with timestamps
 */
async function transcribeSingleFile(audioFilePath, verbose = false) {
  // Get API key at runtime, after dotenv has loaded it
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(audioFilePath));
  form.append('model', 'whisper-1');
  
  // Add nomenclature prompt to help with specialized terminology
  const nomenclaturePrompt = getNomenclaturePrompt();
  form.append('prompt', nomenclaturePrompt);

  // Add response_format for verbose JSON output with timestamps if requested
  if (verbose) {
    form.append('response_format', 'verbose_json');
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      }
    });
    
    // Return full response data if verbose mode is enabled, otherwise just the text
    return verbose ? response.data : response.data.text;
  } catch (err) {
    throw new Error(`Transcription error: ${JSON.stringify(err.response?.data || err.message, null, 2)}`);
  }
}

/**
 * Combines multiple transcription responses into a single response
 * @param {Array<Object>} transcriptions - Array of transcription responses in verbose JSON format
 * @returns {Object} - Combined transcription response
 */
function combineTranscriptions(transcriptions) {
  if (!transcriptions || transcriptions.length === 0) {
    throw new Error('No transcriptions to combine');
  }
  
  // If only one transcription, return it as is
  if (transcriptions.length === 1) {
    return transcriptions[0];
  }
  
  // Initialize combined result with structure from first transcription
  const combined = {
    text: '',
    segments: [],
    language: transcriptions[0].language
  };
  
  let lastEndTime = 0;
  
  // Process each transcription and adjust timestamps
  transcriptions.forEach((transcription, chunkIndex) => {
    // Add text with spacing between chunks
    if (chunkIndex > 0) {
      combined.text += ' ' + transcription.text;
    } else {
      combined.text = transcription.text;
    }
    
    // Adjust segment timestamps and add to combined segments
    if (transcription.segments && Array.isArray(transcription.segments)) {
      const adjustedSegments = transcription.segments.map(segment => ({
        ...segment,
        start: segment.start + lastEndTime,
        end: segment.end + lastEndTime
      }));
      
      combined.segments.push(...adjustedSegments);
      
      // Update lastEndTime for next chunk
      if (adjustedSegments.length > 0) {
        const lastSegment = adjustedSegments[adjustedSegments.length - 1];
        lastEndTime = lastSegment.end;
      }
    }
  });
  
  return combined;
}

/**
 * Transcribes audio using OpenAI's Whisper API, handling multiple file chunks if necessary
 * @param {string|Array<string>} audioFilePaths - Path to the audio file or array of paths to transcribe
 * @param {boolean} [verbose=false] - Whether to return verbose JSON with timestamps
 * @returns {Promise<string|Object>} - Transcription text or full JSON response with timestamps
 */
export async function transcribeWithWhisper(audioFilePaths, verbose = false) {
  // Handle both single file and array of files
  const filePaths = Array.isArray(audioFilePaths) ? audioFilePaths : [audioFilePaths];
  
  // Show how many files we're processing
  console.log(`Transcribing ${filePaths.length} audio file${filePaths.length > 1 ? 's' : ''}...`);
  
  // Spinner for connecting/uploading/transcribing
  const stopSpinner = startSpinner('Connecting to Whisper API and transcribing...');
  
  try {
    // Process each file
    const transcriptions = [];
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      if (filePaths.length > 1) {
        console.log(`Processing chunk ${i+1}/${filePaths.length}: ${filePath}`);
      }
      
      const result = await transcribeSingleFile(filePath, true); // Always use verbose for chunks
      transcriptions.push(result);
    }
    
    stopSpinner();
    
    // Combine transcriptions if we have multiple files
    let finalResult;
    if (transcriptions.length > 1) {
      console.log('Combining transcriptions from multiple chunks...');
      finalResult = combineTranscriptions(transcriptions);
    } else {
      finalResult = transcriptions[0];
    }
    
    // Return based on verbose flag
    return verbose ? finalResult : finalResult.text;
  } catch (err) {
    stopSpinner();
    throw new Error(`Transcription error: ${err.message}`);
  }
}
