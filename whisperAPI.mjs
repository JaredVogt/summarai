import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { startSpinner } from './utils.mjs';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
export async function transcribeWithWhisper(audioFilePath, verbose = false) {
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

  // Spinner for connecting/uploading/transcribing
  const stopSpinner = startSpinner('Connecting to Whisper API and transcribing...');

  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      }
    });
    stopSpinner();
    
    // Return full response data if verbose mode is enabled, otherwise just the text
    return verbose ? response.data : response.data.text;
  } catch (err) {
    stopSpinner();
    throw new Error(`Transcription error: ${JSON.stringify(err.response?.data || err.message, null, 2)}`);
  }
}
