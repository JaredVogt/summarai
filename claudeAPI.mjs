import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startSpinner, sanitizeFilename } from './utils.mjs';
import { retryWithBackoff, defaultShouldRetry } from './retryUtils.mjs';
import { checkForNewerModels } from './modelChecker.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Don't read the API key at import time, will access process.env directly when needed

/**
 * Checks if a summary appears to be generic
 * @param {string} summary - The summary to check
 * @returns {boolean} - True if the summary seems generic
 */
function isGenericSummary(summary) {
  const genericWords = [
    'voice', 'memo', 'summary', 'transcript', 'recording', 'note', 'audio', 'untitled', 'output', 'file'
  ];
  const lower = summary.toLowerCase();
  return genericWords.some(word => lower.includes(word));
}

/**
 * Gets nomenclature prompt to help Whisper with domain-specific terms
 * @returns {string} - Nomenclature prompt text
 */
export function getNomenclatureNote() {
  try {
    const terms = fs.readFileSync('./nomenclature.txt', 'utf8').trim();
    if (!terms) return '';
    return `\n\n---\nThe following is a list of terms, product names, or jargon that may appear in the transcript. Please use this list to help interpret, spell, or summarize the content accurately.\n\n${terms}\n---\n`;
  } catch {
    return '';
  }
}

/**
 * Gets additional instructions from instructions.md
 * @returns {string} - Instruction text
 */
export function getInstructionsNote() {
  let instructions = '';
  try {
    instructions = fs.readFileSync(path.join(__dirname, 'instructions.md'), 'utf8').trim();
    if (instructions) {
      instructions = 'The following are additional instructions to guide your response:\n' + instructions + '\n';
    }
  } catch (e) {
    // If instructions.md does not exist, skip
  }
  return instructions;
}

/**
 * Extracts keywords from Claude's response
 * @param {string} claudeText - Text response from Claude
 * @returns {Array<string>} - Array of keywords
 */
function extractKeywords(claudeText) {
  // Try to extract keywords from a line like "Keywords: ..." or "## Keywords: ..."
  const match = claudeText.match(/^[#\s]*Keywords:\s*(.+)$/im);
  if (match) {
    const keywords = match[1].split(',').map(k => k.trim()).filter(Boolean);
    return keywords;
  }
  return [];
}

/**
 * Gets output keywords from keywords.txt
 * @returns {Array<string>} - Array of keywords
 */
function getOutputKeywords() {
  try {
    return fs.readFileSync(path.join(__dirname, 'keywords.txt'), 'utf8')
      .split(/\r?\n/)
      .map(k => k.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Determines the target directory based on keywords
 * @param {Array<string>} keywordsInSummary - Keywords extracted from summary
 * @param {string} outputDir - Base output directory
 * @returns {string} - Target directory path
 */
function getSingleTargetDir(keywordsInSummary, outputDir) {
  const outputKeywords = getOutputKeywords(); // already lowercased
  const summaryKeywordsLower = keywordsInSummary.map(k => k.toLowerCase());
  const matchedKeyword = outputKeywords.find(k => summaryKeywordsLower.includes(k));
  if (matchedKeyword) {
    return path.join(outputDir, matchedKeyword);
  }
  return outputDir;
}

/**
 * Determines the content type (voice memo, video, audio) based on file extension
 * @param {string} filePath - Path to the file
 * @returns {string} - Content type description
 */
function getContentTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm'];
  if (videoExts.includes(ext)) {
    return 'video';
  }
  return 'audio'; // Default to audio for any other extension
}

/**
 * Sends transcript to Claude for summarization and processing
 * @param {string} transcript - Transcript text to send
 * @param {string} filePath - Path to original file (audio or video)
 * @param {string} recordingDateTimePrefix - Formatted date/time prefix
 * @param {string} recordingDateTime - ISO formatted date/time
 * @param {string} outputDir - Base output directory
 * @param {string} originalFileName - Original filename to preserve date prefix from
 * @returns {Promise<Object>} - Result with finalName, targetDir, and mdFilePath
 */
export async function sendToClaude(transcript, filePath, recordingDateTimePrefix, recordingDateTime, outputDir, originalFileName = null) {
  // Get API key at runtime, after dotenv has loaded it
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set.');
    return;
  }
  const nomenclatureNote = getNomenclatureNote();
  const instructionsNote = getInstructionsNote();
  
  // Determine the content type based on file extension
  const contentType = getContentTypeFromPath(filePath);
  
  // Customize prompt based on content type
  let prompt;
  if (contentType === 'video') {
    prompt = `${instructionsNote}${nomenclatureNote}Here is the transcription from a video file:\n${transcript}`;
  } else {
    prompt = `${instructionsNote}${nomenclatureNote}Here is the audio transcription:\n${transcript}`;
  }
  const spinnerStop = startSpinner('Sending to Claude...');
  let claudeText = '';
  try {
    // Define retry options for Claude API
    const retryOptions = {
      maxRetries: 3,
      operation: 'Claude API request',
      shouldRetry: (error) => {
        // Check for rate limit errors
        if (error.response && error.response.status === 429) {
          console.log('[ClaudeAPI] Rate limit hit, will retry');
          return true;
        }
        // Use default retry logic for other errors
        return defaultShouldRetry(error);
      }
    };

    // Check for newer models (non-blocking)
    const currentModel = 'claude-opus-4-20250514';
    checkForNewerModels(currentModel).catch(err => {
      // Don't let model checking errors interrupt the main flow
      console.error('[ModelChecker] Error checking for newer models:', err.message);
    });

    // Call Claude API with retry logic
    const response = await retryWithBackoff(async () => {
      return await axios.post('https://api.anthropic.com/v1/messages', {
        model: currentModel,
        max_tokens: 16000,
        thinking: {
          type: 'enabled',
          budget_tokens: 10000
        },
        messages: [
          { role: 'user', content: prompt }
        ]
      }, {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: parseInt(process.env.CLAUDE_TIMEOUT_SECONDS) * 1000 || 120000 // 2 minutes default
      });
    }, retryOptions);
    
    spinnerStop();

    // Response received from Claude API

    // Extract content based on Messages API structure
    // Find the content block with type: "text"
    let textBlock = null;
    if (response.data && response.data.content && Array.isArray(response.data.content)) {
      textBlock = response.data.content.find(block => block.type === 'text');
    }

    if (textBlock && textBlock.text) {
      claudeText = textBlock.text;
    } else {
      // Log if the expected content structure is not found
      console.warn('[ClaudeAPI] Claude response did not contain a text block in the content array. Response data:', response.data);
      claudeText = ''; // Default to empty string if no valid content
    }

    if (!claudeText.trim()) { // Check if claudeText is empty or only whitespace
        claudeText = '[No content returned]'; // Set default if still empty after checks
    }

  } catch (err) {
    spinnerStop();
    console.error('[ClaudeAPI] Error calling Claude API:');
    if (err.response) {
      // Axios error with a response from the server
      console.error('Status:', err.response.status);
      console.error('Headers:', JSON.stringify(err.response.headers, null, 2));
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
    } else if (err.request) {
      // Axios error where the request was made but no response was received
      console.error('Request Error: No response received. Request details:', err.request);
    } else {
      // Other errors (e.g., setup issues)
      console.error('Error Message:', err.message);
    }
    console.error('Full error object:', err);
    return; // Exit if there's an error
  }

  // If claudeText is still '[No content returned]' or empty, log the prompt for review
  if (claudeText === '[No content returned]' || !claudeText.trim()) {
    console.warn('[ClaudeAPI] Claude returned no substantive content. Review the prompt:');
    console.warn(prompt.substring(0, 1000) + (prompt.length > 1000 ? '...' : '')); // Log first 1000 chars of prompt
  }

  // Extract the summary after 'Summary:' (with or without brackets)
  let summary = '';
  let summaryMatch = claudeText.match(/Summary:\s*\[([^\]]+)\]/i);
  if (summaryMatch && summaryMatch[1]) {
    summary = sanitizeFilename(summaryMatch[1].trim());
  } else {
    summaryMatch = claudeText.match(/Summary:\s*([^\n]+)/i);
    if (summaryMatch && summaryMatch[1]) {
      summary = sanitizeFilename(summaryMatch[1].trim());
    }
  }
  if (!summary) {
    summary = `memo_${path.basename(filePath).replace(/\.[^.]+$/, '')}`;
  }

  // If originalFileName is provided and contains a date prefix in format YYMMDD_HHMM, use that
  let prefixToUse = recordingDateTimePrefix;
  if (originalFileName) {
    // Match pattern like 250624_0155.mp3 - extract just the date_time part
    const originalDateMatch = originalFileName.match(/^(\d{6}_\d{4})(?:\.|$)/);
    if (originalDateMatch) {
      prefixToUse = originalDateMatch[1];
      console.log(`Using original date prefix from filename: ${prefixToUse}`);
    }
  }

  // Check for existing files with the same date and time prefix, and increment version if needed
  let versionSuffix = '';
  const outputFiles = fs.readdirSync(outputDir);
  // Only match files with the same date and time prefix, regardless of summary
  const prefixPattern = new RegExp(`^${prefixToUse.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1')}`);
  const samePrefixFiles = outputFiles.filter(f => prefixPattern.test(f));
  if (samePrefixFiles.length > 0) {
    // Find the highest _vN suffix used for any file with this prefix
    let maxVersion = 1;
    // Use a simplified regex pattern if prefixToUse contains special characters
    let safePrefix;
    try {
      safePrefix = prefixToUse.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1');
      const versionPattern = new RegExp(`^${safePrefix}.*_v(\\d+)\\.md$`);
      samePrefixFiles.forEach(f => {
        const m = f.match(versionPattern);
        if (m && m[1]) {
          const v = parseInt(m[1], 10);
          if (v > maxVersion) maxVersion = v;
        } else {
          // If no _vN, treat as version 1
          if (maxVersion < 1) maxVersion = 1;
        }
      });
    } catch (error) {
      console.warn('Error with regex pattern for versioning, using default version', error.message);
      maxVersion = 1; // Fallback to version 1 if regex fails
    }
    versionSuffix = `_v${maxVersion + 1}`;
  }
  const finalName = `${prefixToUse}_${summary}${versionSuffix}`;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const keywordsInSummary = extractKeywords(claudeText);
  const targetDir = getSingleTargetDir(keywordsInSummary, outputDir);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const mdFile = path.join(targetDir, `${finalName}.md`);
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  let displayAudioPath = filePath;
  if (homeDir && filePath.startsWith(homeDir)) {
    displayAudioPath = filePath.replace(homeDir, '~');
  }
  // Remove raw transcript section, only include Claude response and basic metadata
  fs.writeFileSync(
    mdFile,
    claudeText.trim() +
    `\n\nOriginal ${getContentTypeFromPath(filePath)} file: "${displayAudioPath}"\nRecording date/time: ${recordingDateTime}\n`
  );
  // Determine the file extension of the original file
  const sourceExt = path.extname(filePath);
  const destPath = path.join(targetDir, `${finalName}${sourceExt}`);
  
  try {
    fs.copyFileSync(filePath, destPath);
    console.log(`Claude output written to: ${mdFile}`);
    console.log(`Original ${getContentTypeFromPath(filePath)} file copied to: ${destPath}`);
  } catch (error) {
    console.error(`Error copying original file: ${error.message}`);
  }
  return { finalName, targetDir, mdFilePath: mdFile };
}
