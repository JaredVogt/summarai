import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startSpinner, sanitizeFilename } from './utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
 * @returns {Promise<Object>} - Result with finalName, targetDir, and mdFilePath
 */
export async function sendToClaude(transcript, filePath, recordingDateTimePrefix, recordingDateTime, outputDir) {
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
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt }
      ]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    spinnerStop();
    claudeText = response.data.content?.[0]?.text || response.data.completion || '[No content returned]';
  } catch (err) {
    spinnerStop();
    console.error('Error from Claude:', err.response?.data || err.message);
    return;
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

  // Check for existing files with the same date and time prefix, and increment version if needed
  let versionSuffix = '';
  const outputFiles = fs.readdirSync(outputDir);
  // Only match files with the same date and time prefix, regardless of summary
  const prefixPattern = new RegExp(`^${recordingDateTimePrefix.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1')}`);
  const samePrefixFiles = outputFiles.filter(f => prefixPattern.test(f));
  if (samePrefixFiles.length > 0) {
    // Find the highest _vN suffix used for any file with this prefix
    let maxVersion = 1;
    // Use a simplified regex pattern if recordingDateTimePrefix contains special characters
    let safePrefix;
    try {
      safePrefix = recordingDateTimePrefix.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1');
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
  const finalName = `${recordingDateTimePrefix}_${summary}${versionSuffix}`;

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
