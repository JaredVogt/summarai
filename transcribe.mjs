import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLatestVoiceMemos } from './getLatestVoiceMemo.mjs';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { promisify } from 'util';
import { sendToClaude } from './claudeAPI.mjs';
import { transcribeWithWhisper } from './whisperAPI.mjs';
import { convertToTempAAC, cleanupTempDir } from './audioProcessing.mjs';
import { startSpinner, sanitizeFilename } from './utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = '/Users/jaredvogt/Library/CloudStorage/GoogleDrive-jared@wolffaudio.com/My Drive/VM_transcription';

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
  // Always convert to temp AAC
  const tempDir = path.join(path.dirname(filePath), 'temp');
  const tempAACPath = await convertToTempAAC(filePath, tempDir);
  let usedTemp = true;
  console.log('Processing voice memo:', originalFileName);
  try {
    // Use verbose mode to get timestamps and detailed JSON
    const transcriptionData = await transcribeWithWhisper(tempAACPath, true);
    
    // Extract the text transcript from the response
    const transcript = transcriptionData.text;
    
    // Create a timestamped segments text with lowercase heading
    let segmentsContent = "## transcription with timestamps\n";
    if (transcriptionData.segments && Array.isArray(transcriptionData.segments)) {
      transcriptionData.segments.forEach((segment, i) => {
        const startTime = formatTimestamp(segment.start);
        const endTime = formatTimestamp(segment.end);
        segmentsContent += `[${startTime} - ${endTime}] ${segment.text}\n`;
      });
    }
    
    // Print the timestamped transcription instead of just the text
    console.log('Transcription:');
    console.log(segmentsContent);
  
    // Send to Claude and write output (markdown + audio)
    // Pass the original .m4a path, not the temp AAC
    const { finalName, targetDir, mdFilePath } = await sendToClaude(transcript, filePath, recordingDateTimePrefix, recordingDateTime, OUTPUT_DIR);
    
    // Write segments to a file
    const segmentsFile = path.join(targetDir, `${finalName}_segments.txt`);
    fs.writeFileSync(segmentsFile, segmentsContent);
    console.log(`Segments with timestamps written to: ${segmentsFile}`);
    
    // Append segments to the markdown file
    if (mdFilePath && fs.existsSync(mdFilePath)) {
      fs.appendFileSync(mdFilePath, '\n\n' + segmentsContent);
      console.log(`Timestamps appended to markdown file: ${mdFilePath}`);
    }
  
    // Add to process_history.json in root
    addToProcessHistory(originalFileName, recordingDateTime || new Date().toISOString());
    return { finalName, targetDir, transcript, segmentsContent };
  } catch (error) {
    console.error(error.message);
  } finally {
    if (usedTemp) cleanupTempDir(tempDir);
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

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  transcribeLatestVoiceMemo();
}

export { transcribeLatestVoiceMemo };
