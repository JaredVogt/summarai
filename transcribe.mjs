import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLatestVoiceMemos } from './getLatestVoiceMemo.mjs';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
const exec = promisify(execCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OUTPUT_DIR = '/Users/jaredvogt/Library/CloudStorage/GoogleDrive-jared@wolffaudio.com/My Drive/VM_transcription';
const NOMENCLATURE_PATH = './nomenclature.txt';

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

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').substring(0, 60);
}

function isGenericSummary(summary) {
  const genericWords = [
    'voice', 'memo', 'summary', 'transcript', 'recording', 'note', 'audio', 'untitled', 'output', 'file'
  ];
  const lower = summary.toLowerCase();
  return genericWords.some(word => lower.includes(word));
}

function getNomenclatureNote() {
  let terms = '';
  try {
    terms = fs.readFileSync(NOMENCLATURE_PATH, 'utf8').trim();
  } catch {
    return '';
  }
  if (!terms) return '';
  return `\n\n---\nThe following is a list of terms, product names, or jargon that may appear in the transcript. Please use this list to help interpret, spell, or summarize the content accurately.\n\n${terms}\n---\n`;
}

function getInstructionsNote() {
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

function extractKeywords(claudeText) {
  // Try to extract keywords from a line like "Keywords: ..." or "## Keywords: ..."
  const match = claudeText.match(/^[#\s]*Keywords:\s*(.+)$/im);
  if (match) {
    const keywords = match[1].split(',').map(k => k.trim()).filter(Boolean);
    return keywords;
  }
  return [];
}

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

function getSingleTargetDir(keywordsInSummary) {
  const outputKeywords = getOutputKeywords(); // already lowercased
  const summaryKeywordsLower = keywordsInSummary.map(k => k.toLowerCase());
  const matchedKeyword = outputKeywords.find(k => summaryKeywordsLower.includes(k));
  if (matchedKeyword) {
    return path.join(OUTPUT_DIR, matchedKeyword);
  }
  return OUTPUT_DIR;
}

async function sendToClaude(transcript, m4aFilePath, recordingDateTimePrefix, recordingDateTime) {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set.');
    return;
  }
  const nomenclatureNote = getNomenclatureNote();
  const instructionsNote = getInstructionsNote();
  const prompt = `${instructionsNote}${nomenclatureNote}Here is the voice memo transcription:\n${transcript}`;
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
    summary = `memo_${path.basename(m4aFilePath).replace(/\.[^.]+$/, '')}`;
  }

  // Check for existing files with the same date and time prefix, and increment version if needed
  let versionSuffix = '';
  const outputFiles = fs.readdirSync(OUTPUT_DIR);
  // Only match files with the same date and time prefix, regardless of summary
  const prefixPattern = new RegExp(`^${recordingDateTimePrefix.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1')}`);
  const samePrefixFiles = outputFiles.filter(f => prefixPattern.test(f));
  if (samePrefixFiles.length > 0) {
    // Find the highest _vN suffix used for any file with this prefix
    let maxVersion = 1;
    const versionPattern = new RegExp(`^${recordingDateTimePrefix.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1')}.*_v(\\d+)\\.md$`);
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
    versionSuffix = `_v${maxVersion + 1}`;
  }
  const finalName = `${recordingDateTimePrefix}_${summary}${versionSuffix}`;

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  const keywordsInSummary = extractKeywords(claudeText);
  const targetDir = getSingleTargetDir(keywordsInSummary);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const mdFile = path.join(targetDir, `${finalName}.md`);
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  let displayAudioPath = m4aFilePath;
  if (homeDir && m4aFilePath.startsWith(homeDir)) {
    displayAudioPath = m4aFilePath.replace(homeDir, '~');
  }
  fs.writeFileSync(
    mdFile,
    claudeText.trim() +
    `\n\nOriginal audio file: "${displayAudioPath}"\nRecording date/time: ${recordingDateTime}\n` +
    `\n# Transcription\n\n${transcript}\n`
  );
  const m4aDest = path.join(targetDir, `${finalName}.m4a`);
  fs.copyFileSync(m4aFilePath, m4aDest);
  console.log(`Claude output written to: ${mdFile}`);
  console.log(`Voice memo audio copied to: ${m4aDest}`);
  return { finalName, targetDir };
}

async function convertToTempMp3(inputPath, tempDir) {
  const tempMp3 = path.join(tempDir, 'temp.mp3');
  // Ensure tempDir exists
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  // Remove previous temp.mp3 if exists
  if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
  const cmd = `ffmpeg -i "${inputPath}" -c:a libmp3lame -b:a 96k "${tempMp3}" -y`;
  await exec(cmd);
  // Log out the resulting file size
  if (fs.existsSync(tempMp3)) {
    const stats = fs.statSync(tempMp3);
    console.log(`Converted file size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  }
  return tempMp3;
}

function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.readdirSync(tempDir).forEach(f => fs.unlinkSync(path.join(tempDir, f)));
    fs.rmdirSync(tempDir);
  }
}

async function transcribeLatestVoiceMemo() {
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
    console.error('Error finding voice memos:', err.message);
    rl.close();
    return;
  }
  // Filter out already processed files
  const processed = getProcessedFilenames();
  files = files.filter(f => {
    const originalFileName = path.basename(f.file);
    // Check if this exact file has been processed before
    const isProcessed = processed.has(originalFileName);
    return !isProcessed;
  });
  if (!files.length) {
    console.error('No unprocessed files found.');
    rl.close();
    return;
  }

  console.log('\nRecent Voice Memos:');
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
    console.log(`${i + 1}. ${file}${info.length ? ' (' + info.join(', ') + ')' : ''}`);
  }

  let selected = 0;
  try {
    const sel = await rl.question('Select a file to transcribe (number): ');
    selected = Math.max(1, Math.min(files.length, parseInt(sel, 10) || 1)) - 1;
  } catch {
    selected = 0;
  }
  rl.close();
  
  // Process the selected file using processVoiceMemo
  await processVoiceMemo(files[selected].fullPath);
}

// Exportable main workflow for automation
export async function processVoiceMemo(filePath) {
  const originalFileName = path.basename(filePath);
  let recordingDateTime = null;
  let recordingDateTimePrefix = null;
  const dtMatch = originalFileName.match(/(\d{8})[ _-](\d{6})/);
  if (dtMatch) {
    const [_, ymd, hms] = dtMatch;
    recordingDateTimePrefix = `${ymd}_${hms.slice(0,2)}:${hms.slice(2,4)}:${hms.slice(4,6)}`;
    const year = ymd.slice(0, 4);
    const month = ymd.slice(4, 6);
    const day = ymd.slice(6, 8);
    const hour = hms.slice(0, 2);
    const min = hms.slice(2, 4);
    const sec = hms.slice(4, 6);
    recordingDateTime = `${year}-${month}-${day}T${hour}:${min}:${sec}-07:00`;
  }
  // Always convert to temp mp3
  const tempDir = path.join(path.dirname(filePath), 'temp');
  const tempMp3Path = await convertToTempMp3(filePath, tempDir);
  let usedTemp = true;
  console.log('Processing voice memo:', originalFileName);
  const form = new FormData();
  form.append('file', fs.createReadStream(tempMp3Path));
  form.append('model', 'whisper-1');
  const nomenclaturePrompt = getNomenclaturePrompt();
  form.append('prompt', nomenclaturePrompt);
  const stopSpinner = startSpinner('Connecting and transcribing...');
  let transcript = '';
  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      }
    });
    stopSpinner();
    transcript = response.data.text;
    console.log('Transcription:', transcript);
  } catch (err) {
    stopSpinner();
    console.error('Transcription error:', err.response?.data || err.message);
    return;
  } finally {
    if (usedTemp) cleanupTempDir(tempDir);
  }
  // Send to Claude and write output (markdown + audio)
  // Pass the original .m4a path, not the temp mp3
  const { finalName, targetDir } = await sendToClaude(transcript, filePath, recordingDateTimePrefix, recordingDateTime);
  // Write Whisper transcription to .txt file with same prefix as markdown/audio, only in the same dir
  const txtFile = path.join(targetDir, `${finalName}.txt`);
  fs.writeFileSync(txtFile, transcript);
  console.log(`Whisper transcription written to: ${txtFile}`);

  // Add to process_history.json in root
  addToProcessHistory(originalFileName, recordingDateTime || new Date().toISOString());
}

function getNomenclaturePrompt() {
  try {
    return fs.readFileSync(path.join(__dirname, 'nomenclature.txt'), 'utf8');
  } catch {
    return '';
  }
}

// Helper to get processed filenames from process_history.json
function getProcessedFilenames() {
  const historyPath = path.join(__dirname, 'process_history.json');
  if (!fs.existsSync(historyPath)) return new Set();
  try {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    if (!Array.isArray(history)) return new Set();
    return new Set(history.map(entry => entry.filename));
  } catch {
    return new Set();
  }
}

// Helper to add processed file to process_history.json
function addToProcessHistory(filename, timestamp) {
  const historyPath = path.join(__dirname, 'process_history.json');
  
  // Check if directory is writable
  try {
    fs.accessSync(path.dirname(historyPath), fs.constants.W_OK);
  } catch (error) {
    console.error(`Error: Directory is not writable: ${path.dirname(historyPath)}`);
    console.error(`Permission error: ${error.message}`);
    return; // Exit function if directory is not writable
  }
  
  let history = [];
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }
  history.push({ filename, timestamp });
  try {
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error(`Error writing to process_history.json: ${error.message}`);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  transcribeLatestVoiceMemo();
}

export { transcribeLatestVoiceMemo };
