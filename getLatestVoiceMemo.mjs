import { readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);
const recordingsDir = path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.VoiceMemos.shared', 'Recordings');

// Helper to extract datetime from filename
function extractDateTimeFromFilename(filename) {
  const match = filename.match(/(\d{8})[ _](\d{6})/);
  if (!match) return null;
  const [_, date, time] = match;
  return new Date(`${date.substring(0,4)}-${date.substring(4,6)}-${date.substring(6,8)}T${time.substring(0,2)}:${time.substring(2,4)}:${time.substring(4,6)}`);
}

// Helper to extract afinfo metadata
async function getAfinfoData(filePath) {
  try {
    const { stdout } = await exec(`afinfo "${filePath}"`);
    let duration = '', date = '', gps = '';
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('estimated duration:')) {
        duration = line.split(':').pop().trim();
      }
      if (/creation date/i.test(line)) {
        date = line.split(':').pop().trim();
      }
      if (/GPS/i.test(line)) {
        gps = line.split(':').pop().trim();
      }
    }
    return { duration, date, gps };
  } catch {
    return { duration: '', date: '', gps: '' };
  }
}

export async function getLatestVoiceMemos(count = 1) {
  let files;
  try {
    files = await readdir(recordingsDir);
  } catch (err) {
    throw new Error('Error reading directory: ' + err.message);
  }
  if (!files.length) {
    throw new Error('No files found.');
  }

  const m4aFiles = files.filter(file => file.toLowerCase().endsWith('.m4a'));
  if (!m4aFiles.length) {
    throw new Error('No .m4a files found.');
  }

  // Map .m4a files to their parsed datetime and afinfo metadata
  const filesWithMeta = await Promise.all(m4aFiles.map(async file => {
    const fullPath = path.join(recordingsDir, file);
    const fileDate = extractDateTimeFromFilename(file);
    const afinfo = await getAfinfoData(fullPath);
    return { file, fullPath, fileDate, ...afinfo };
  }));
  const validFiles = filesWithMeta.filter(entry => entry.fileDate);
  if (!validFiles.length) {
    throw new Error('No .m4a files with valid date in filename found.');
  }
  validFiles.sort((a, b) => b.fileDate - a.fileDate);
  return validFiles.slice(0, count);
}
