import { readdir, stat } from 'fs/promises';
import path from 'path';
import os from 'os';

const recordingsDir = path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.VoiceMemos.shared', 'Recordings');

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

  // Only consider .m4a files
  const m4aFiles = files.filter(file => file.toLowerCase().endsWith('.m4a'));
  if (!m4aFiles.length) {
    throw new Error('No .m4a files found.');
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
    throw new Error('No .m4a files found.');
  }

  // Sort descending by mtime and return up to 'count' files
  onlyFiles.sort((a, b) => b.mtime - a.mtime);
  return onlyFiles.slice(0, count);
}
