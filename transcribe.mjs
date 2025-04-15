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

async function getDescriptiveSummary(markdown, transcript) {
  const prompt = `Here is a voice memo transcription and its markdown summary. Please provide a 5-word-or-less descriptive summary for this content, suitable for a filename. Do not include generic words like 'Voice Memo Summary'. Only return the phrase.\n\nTranscription:\n${transcript}\n\nMarkdown Summary:\n${markdown}`;
  const spinnerStop = startSpinner('Getting short summary from Claude...');
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 20,
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
    const text = response.data.content?.[0]?.text || response.data.completion || '';
    return sanitizeFilename(text.trim());
  } catch (err) {
    spinnerStop();
    console.error('Error getting descriptive summary from Claude:', err.response?.data || err.message);
    return '';
  }
}

async function sendToClaude(transcript, m4aFilePath) {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set.');
    return;
  }
  const prompt = `Here is a voice memo transcription. Please summarize or process as appropriate.\n\n${transcript}`;
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

  // Extract summary field from Claude output (first line, e.g., '# Voice Memo Summary: ...')
  let summary = '';
  const match = claudeText.match(/^#\s*[^:]+:([^\n]*)/i);
  if (match && match[1]) {
    summary = sanitizeFilename(match[1].trim());
  } else {
    // Try fallback: first non-empty line
    const lines = claudeText.split('\n').filter(Boolean);
    if (lines.length) summary = sanitizeFilename(lines[0].replace(/^#+\s*/, ''));
  }

  // If summary is missing or generic, get a better one from Claude
  if (!summary || isGenericSummary(summary)) {
    const betterSummary = await getDescriptiveSummary(claudeText, transcript);
    if (betterSummary && !isGenericSummary(betterSummary)) {
      summary = betterSummary;
    } else {
      // Still generic, use timestamp from audio file for uniqueness
      const base = path.basename(m4aFilePath).replace(/\.[^.]+$/, '');
      summary = `memo_${base}`;
    }
  }
  if (!summary) summary = 'voice_memo';

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  // Write markdown file
  const mdFile = path.join(OUTPUT_DIR, `${summary}.md`);
  fs.writeFileSync(mdFile, claudeText);
  console.log(`Claude output written to ${mdFile}`);

  // Copy m4a file
  const m4aDest = path.join(OUTPUT_DIR, `${summary}.m4a`);
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
