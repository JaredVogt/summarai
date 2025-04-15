import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { getLatestVoiceMemos } from './getLatestVoiceMemo.mjs';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OUTPUT_DIR = './output';
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

async function sendToClaude(transcript, m4aFilePath) {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set.');
    return;
  }
  const nomenclatureNote = getNomenclatureNote();
  const prompt = `Here is the voice memo transcription. Please create a summary of no more than 6 words at the top, formatted as 'Summary: [your summary]'. Then, provide a more in-depth summarization including bullet points, and finally, end with any action items.${nomenclatureNote}\n\n${transcript}`;
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

  // Extract the date and time from the original audio filename (assumes format: YYYYMMDD HHMMSS-xxxx.m4a)
  const base = path.basename(m4aFilePath).replace(/\.[^.]+$/, '');
  const dateTimeMatch = base.match(/(\d{8})[ _](\d{6})/);
  let prefix = '';
  if (dateTimeMatch) {
    const date = dateTimeMatch[1];
    const timeRaw = dateTimeMatch[2];
    const time = `${timeRaw.substring(0,2)}:${timeRaw.substring(2,4)}:${timeRaw.substring(4,6)}`; // military format
    prefix = `${date}_${time}_`;
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
    summary = `memo_${base}`;
  }
  const finalName = prefix + summary;

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  // Append the original m4a filename to the summary markdown
  const origM4AName = path.basename(m4aFilePath);
  const mdFile = path.join(OUTPUT_DIR, `${finalName}.md`);
  // Add a blank line before the filename for readability
  fs.writeFileSync(mdFile, claudeText.trim() + `\n\nOriginal audio file: ${origM4AName}\n`);
  console.log(`Claude output written to ${mdFile}`);

  // Copy m4a file
  const m4aDest = path.join(OUTPUT_DIR, `${finalName}.m4a`);
  fs.copyFileSync(m4aFilePath, m4aDest);
  console.log(`Voice memo audio copied to ${m4aDest}`);

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
  if (!files.length) {
    console.error('No files found.');
    rl.close();
    return;
  }
  console.log('\nRecent Voice Memos:');
  files.forEach((f, i) => {
    console.log(`${i + 1}. ${f.file} (modified: ${f.mtime.toLocaleString()})`);
  });
  let selected = 0;
  try {
    const sel = await rl.question('Select a file to transcribe (number): ');
    selected = Math.max(1, Math.min(files.length, parseInt(sel, 10) || 1)) - 1;
  } catch {
    selected = 0;
  }
  rl.close();
  const audioFilePath = files[selected].fullPath;
  console.log('Selected voice memo file:', audioFilePath);

  const form = new FormData();
  form.append('file', fs.createReadStream(audioFilePath));
  form.append('model', 'whisper-1');

  // Spinner for connecting/uploading/transcribing
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
  }

  // Send to Claude and write output (markdown + audio)
  await sendToClaude(transcript, audioFilePath);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  transcribeLatestVoiceMemo();
}

export { transcribeLatestVoiceMemo };
