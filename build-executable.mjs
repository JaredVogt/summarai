#!/usr/bin/env bun

import { $ } from "bun";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Build configuration
const VERSION = "1.0.0";
const BUILD_DATE = new Date().toISOString().split('T')[0];
const MINIFY = process.argv.includes('--minify');
const CREATE_ZIP = process.argv.includes('--zip');

// Output directory - changed to 'release'
const OUTPUT_DIR = path.join(__dirname, 'release');

// Clean and ensure output directory exists
if (fs.existsSync(OUTPUT_DIR)) {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('Building watchDirectories executable for macOS ARM64...');
console.log(`Version: ${VERSION}`);
console.log(`Build Date: ${BUILD_DATE}`);
console.log(`Minification: ${MINIFY ? 'enabled' : 'disabled'}`);

// Build command
const buildArgs = [
  'build',
  '--compile',
  '--target=bun-darwin-arm64',
  `--define=BUILD_VERSION='"${VERSION}"'`,
  `--define=BUILD_DATE='"${BUILD_DATE}"'`,
  './watchDirectories.mjs',
  '--outfile', path.join(OUTPUT_DIR, 'watchDirectories')
];

if (MINIFY) {
  buildArgs.splice(3, 0, '--minify');
}

try {
  // Run the build
  await $`bun ${buildArgs}`;
  
  console.log('✓ Build successful!');
  
  // Copy config.yaml to release directory
  console.log('Copying configuration file...');
  if (fs.existsSync('config.yaml')) {
    fs.copyFileSync('config.yaml', path.join(OUTPUT_DIR, 'config.yaml'));
    console.log('✓ Copied config.yaml');
  } else if (fs.existsSync('example.config.yaml')) {
    fs.copyFileSync('example.config.yaml', path.join(OUTPUT_DIR, 'config.yaml'));
    console.log('✓ Copied example.config.yaml as config.yaml');
  }
  
  // Create .env.example
  const envExample = `# API Keys Configuration
# Copy this file to .env and fill in your actual API keys

# OpenAI API Key for Whisper transcription
OPENAI_API_KEY=your_openai_api_key_here

# Anthropic API Key for Claude
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# ElevenLabs API Key for Scribe transcription
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
`;
  
  fs.writeFileSync(path.join(OUTPUT_DIR, '.env.example'), envExample);
  console.log('✓ Created .env.example');
  
  // Create README specifically for the executable release
  const readme = `# watchDirectories Executable

## Quick Start

This is a standalone executable version of watchDirectories for macOS ARM64 (Apple Silicon).

### First Run on macOS

When running this executable for the first time, macOS will show a security warning:
"watchDirectories cannot be opened because it is from an unidentified developer"

**To run it:**
1. Right-click (or Control-click) on \`watchDirectories\`
2. Select "Open" from the context menu
3. Click "Open" in the security dialog
4. This only needs to be done once

### Setup

1. **Configure API Keys**
   - Copy \`.env.example\` to \`.env\`
   - Add your API keys to the \`.env\` file

2. **Review Configuration**
   - Edit \`config.yaml\` to match your directory paths and preferences
   - Key settings to update:
     - \`directories.voiceMemos\`: Path to Apple Voice Memos
     - \`directories.googleDrive.unprocessed\`: Path to Google Drive folder
     - \`transcription.defaultService\`: Choose 'whisper' or 'scribe'

3. **Run the Executable**
   \`\`\`bash
   ./watchDirectories
   \`\`\`

## Usage

### Basic Commands

\`\`\`bash
# Watch directories for new files
./watchDirectories

# Process recent voice memos (last 120 days)
./watchDirectories --process-recent-vm

# Process voice memos from specific date range
./watchDirectories --process-recent-vm 1-1-25:1-31-25

# Process existing Google Drive files
./watchDirectories --cleanout

# Show help and all options
./watchDirectories --help
\`\`\`

### Command Options

- \`--process-recent-vm [date-range]\` - Process unprocessed Voice Memos
  - No date: last 120 days
  - Single date (MM-DD-YY): from that date to now
  - Date range (MM-DD-YY:MM-DD-YY): specific range
- \`--cleanout\` - Process all existing files in Google Drive unprocessed folder
- \`--dry-run\` - Preview what would be processed without actually processing
- \`--help\` - Show detailed help

## File Processing

The executable watches two directories:
1. **Apple Voice Memos** - Files are transcribed but never moved
2. **Google Drive Unprocessed** - Files are transcribed and moved to processed folder

Supported formats: .m4a, .mp3, .wav, .mp4, .mov

## Troubleshooting

### "Cannot find config.yaml"
- Ensure config.yaml is in the same directory as the executable
- Check file permissions

### "Missing API keys"
- Copy \`.env.example\` to \`.env\`
- Add your actual API keys to \`.env\`

### "Directory not found" errors
- Update paths in config.yaml to match your system
- Ensure directories exist and have read/write permissions

## Version Info
- Version: ${VERSION}
- Build Date: ${BUILD_DATE}
- Platform: macOS ARM64 (Apple Silicon)
- Runtime: Bun (embedded)

## Support

For issues or questions, see the main project repository.
`;
  
  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), readme);
  console.log('✓ Created README.md');
  
  // Get file size
  const stats = fs.statSync(path.join(OUTPUT_DIR, 'watchDirectories'));
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log('\\n📦 Build Summary:');
  console.log(`   Output: ${OUTPUT_DIR}/`);
  console.log(`   Executable size: ${sizeMB} MB`);
  console.log(`   Files in release directory:`);
  console.log(`   - watchDirectories (executable)`);
  console.log(`   - config.yaml`);
  console.log(`   - .env.example`);
  console.log(`   - README.md`);
  
  // Create zip archive if requested
  if (CREATE_ZIP) {
    const archiveName = `watchDirectories-macos-arm64-v${VERSION}.zip`;
    console.log(`\\nCreating distribution archive: ${archiveName}`);
    
    await $`cd release && zip -r ../${archiveName} .`;
    
    const archiveStats = fs.statSync(path.join(__dirname, archiveName));
    const archiveSizeMB = (archiveStats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`✓ Created ${archiveName} (${archiveSizeMB} MB)`);
    console.log(`\\nTo distribute:`);
    console.log(`1. Share the ${archiveName} file`);
    console.log(`2. Users unzip and follow README instructions`);
  }
  
  console.log('\\n✅ Release package ready in ./release/');
  
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}