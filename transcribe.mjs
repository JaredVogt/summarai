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
import { transcribeWithScribe, createSegmentsContent } from './scribeAPI.mjs';
import { convertToTempAAC, cleanupTempDir, splitAudioFile } from './audioProcessing.mjs';
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
  
  // Ask user which transcription service to use
  let transcriptionService = 'whisper';
  try {
    const serviceAnswer = await rl.question('Which transcription service would you like to use? (1: OpenAI Whisper, 2: ElevenLabs Scribe) [1]: ');
    if (serviceAnswer === '2') {
      transcriptionService = 'scribe';
    }
  } catch {
    transcriptionService = 'whisper';
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
  await processVoiceMemo(files[selected].fullPath, { transcriptionService });
}

// Exportable main workflow for automation
export async function processVoiceMemo(filePath, { forceVideoMode = false, lowQuality = false, transcriptionService = 'whisper' } = {}) {
  const originalFileName = path.basename(filePath);
  let recordingDateTime = null;
  let recordingDateTimePrefix = null;
  
  // Try to extract date/time from filename pattern (common for voice memos)
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
    recordingDateTimePrefix = `${year}${month}${day}_${hour}:${min}:${sec}`;
    recordingDateTime = now.toISOString();
  }
  // Always convert to temp AAC
  const tempDir = path.join(path.dirname(filePath), 'temp');
  const tempAACPath = await convertToTempAAC(filePath, tempDir, {
    forceAudioExtraction: forceVideoMode,
    lowQuality: lowQuality
  });
  let usedTemp = true;
  console.log('Processing file:', originalFileName);
  try {
    // Get file size for logging
    const stats = fs.statSync(tempAACPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    console.log(`Using transcription service: ${transcriptionService === 'whisper' ? 'OpenAI Whisper' : 'ElevenLabs Scribe'}`);
    
    let transcriptionData;
    let transcript;
    let segmentsContent;
    
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
      console.log(`Audio file size (${fileSizeMB.toFixed(2)} MB) - ElevenLabs Scribe can handle up to 1GB`);
      
      // Ask for additional options if using Scribe
      const rl = readline.createInterface({ input, output });
      let model = 'scribe_v1';
      try {
        const modelAnswer = await rl.question('Which Scribe model would you like to use? (1: scribe_v1, 2: scribe_v1_experimental) [1]: ');
        if (modelAnswer === '2') {
          model = 'scribe_v1_experimental';
        }
      } catch {
        // Use default
      }
      
      let maxSpeakers = null;
      try {
        const speakersAnswer = await rl.question('Maximum number of speakers to detect (Enter for auto): ');
        const speakersNum = parseInt(speakersAnswer, 10);
        if (!isNaN(speakersNum) && speakersNum > 0 && speakersNum <= 32) {
          maxSpeakers = speakersNum;
        }
      } catch {
        // Use default (auto)
      }
      rl.close();
      
      // Use ElevenLabs Scribe for transcription
      transcriptionData = await transcribeWithScribe(tempAACPath, {
        model,
        maxSpeakers,
        tagAudioEvents: true,
        verbose: true
      });
      
      // Extract the text transcript
      transcript = transcriptionData.text;
      
      // Create segments content using the helper function
      segmentsContent = createSegmentsContent(transcriptionData);
    }
    
    // Don't print the full transcript to console to reduce output verbosity
    console.log('Transcription processed successfully.');
    // Just show transcript length as indicator
    console.log(`Transcript length: ${transcript.length} characters, ${transcript.split(/\s+/).length} words`);
  
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

// Parse command line arguments to check for a directly specified file and options
function parseCommandLineArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return null;
  }

  let filePath = null;
  let forceVideoMode = false;
  let lowQuality = false;
  let showHelp = false;
  let transcriptionService = 'whisper'; // Default to Whisper

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--video' || arg === '-v') {
      forceVideoMode = true;
      console.log('Video mode enabled: will force audio extraction');
    } else if (arg === '--low-quality' || arg === '-l') {
      lowQuality = true;
      console.log('Low quality mode enabled: will use more aggressive compression');
    } else if (arg === '--scribe' || arg === '-s') {
      transcriptionService = 'scribe';
      console.log('Using ElevenLabs Scribe for transcription');
    } else if (arg === '--whisper' || arg === '-w') {
      transcriptionService = 'whisper';
      console.log('Using OpenAI Whisper for transcription');
    } else if (!arg.startsWith('-') && !filePath) {
      filePath = arg;
    }
  }

  if (showHelp) {
    showHelp();
    process.exit(0);
  }

  if (!filePath) {
    return null;
  }

  // Convert relative path to absolute if needed
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(process.cwd(), filePath);
  }

  // Verify file exists
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  return { filePath, forceVideoMode, lowQuality, transcriptionService };
}

// Display help information
function showHelp() {
  console.log(`
Voice Memo Transcription Utility

Usage: node transcribe.mjs [options] [file_path]

Options:
  --help, -h       Show this help message
  --video, -v      Force video mode (extract audio from video)
  --low-quality, -l Use lower quality audio for faster processing
  --whisper, -w    Use OpenAI Whisper for transcription (default)
  --scribe, -s     Use ElevenLabs Scribe for transcription

Transcription Services:
  - OpenAI Whisper: 25MB file size limit, chunks larger files automatically
  - ElevenLabs Scribe: Up to 1GB files, better speaker detection

Examples:
  node transcribe.mjs                        # Interactive mode
  node transcribe.mjs recording.m4a          # Process specific file with Whisper
  node transcribe.mjs --video recording.mp4  # Process video file with Whisper
  node transcribe.mjs --scribe large.mp3     # Process with ElevenLabs Scribe
`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseCommandLineArgs();
  if (args && args.filePath) {
    // Direct file processing mode
    console.log(`Processing file: ${args.filePath}`);
    // Pass options object
    processVoiceMemo(args.filePath, {
      forceVideoMode: args.options?.forceVideoMode || false,
      lowQuality: args.options?.lowQuality || false
    });
  } else if (args === null && process.argv.length > 2) {
    // Arguments were provided but invalid (help shown or error occurred)
    // Do nothing, as error messages or help already displayed
  } else {
    // Interactive mode
    transcribeLatestVoiceMemo();
  }
}

export { transcribeLatestVoiceMemo };
