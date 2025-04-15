import chokidar from 'chokidar';
import path from 'path';
import { fileURLToPath } from 'url';
import { processVoiceMemo } from './transcribe.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const recordingsDir = path.join(
  process.env.HOME,
  'Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings'
);

const processed = new Set();

chokidar.watch(recordingsDir, { ignoreInitial: true })
  .on('add', async filePath => {
    if (filePath.endsWith('.m4a') && !processed.has(filePath)) {
      // Wait 3 seconds to ensure file is fully written
      await new Promise(res => setTimeout(res, 3000));
      processed.add(filePath);
      try {
        await processVoiceMemo(filePath);
      } catch (err) {
        console.error('Error processing voice memo:', err);
      }
    }
  });

console.log('Watching for new voice memos in:', recordingsDir);
