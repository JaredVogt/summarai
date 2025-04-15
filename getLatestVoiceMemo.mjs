import { readdir, stat } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';

const recordingsDir = path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.VoiceMemos.shared', 'Recordings');
const shouldRead = process.argv.includes('-read') || process.argv.includes('--read');

async function getLatestVoiceMemo() {
  let files;
  try {
    files = await readdir(recordingsDir);
  } catch (err) {
    console.error('Error reading directory:', err);
    return;
  }
  if (!files.length) {
    console.log('No files found.');
    return;
  }

  // Only consider .m4a files
  const m4aFiles = files.filter(file => file.toLowerCase().endsWith('.m4a'));
  if (!m4aFiles.length) {
    console.log('No .m4a files found.');
    return;
  }

  // Map .m4a files to their stats
  const filesWithStats = await Promise.all(
    m4aFiles.map(async file => {
      const fullPath = path.join(recordingsDir, file);
      const stats = await stat(fullPath);
      return { file, fullPath, mtime: stats.mtime };
    })
  );

  // Filter only files (not directories)
  const onlyFiles = filesWithStats.filter(entry => entry.mtime && entry.file);

  if (!onlyFiles.length) {
    console.log('No .m4a files found.');
    return;
  }

  // Find the latest .m4a file
  onlyFiles.sort((a, b) => b.mtime - a.mtime);
  const latest = onlyFiles[0];

  console.log('Latest .m4a file:', latest.file);

  if (shouldRead) {
    // Play the .m4a file with afplay (macOS)
    const afplay = spawn('afplay', [latest.fullPath], { stdio: 'inherit' });
    afplay.on('close', () => {});
  }
}

getLatestVoiceMemo();
