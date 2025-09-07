#!/usr/bin/env bun

import { $ } from "bun";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json (single source of truth)
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const VERSION = packageJson.version;
const BUILD_DATE = new Date().toISOString().split('T')[0];
const BUILD_TIME = new Date().toISOString();
const MINIFY = process.argv.includes('--minify');
const CREATE_ZIP = process.argv.includes('--zip');
const INCREMENT_VERSION = process.argv.includes('--increment');

/**
 * Auto-increment version if requested
 */
function incrementVersion(currentVersion, type = 'patch') {
  const [major, minor, patch] = currentVersion.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

// Handle version increment if requested
let finalVersion = VERSION;
if (INCREMENT_VERSION) {
  const incrementType = process.argv.find(arg => ['--major', '--minor', '--patch'].includes(arg))?.replace('--', '') || 'patch';
  finalVersion = incrementVersion(VERSION, incrementType);

  // Update package.json with new version
  packageJson.version = finalVersion;
  fs.writeFileSync(path.join(__dirname, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');

  console.log(`📈 Version incremented: ${VERSION} → ${finalVersion} (${incrementType})`);
}

// Output directory - changed to 'release'
const OUTPUT_DIR = path.join(__dirname, 'release');

// Clean and ensure output directory exists
if (fs.existsSync(OUTPUT_DIR)) {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('🚀 Building summarai executable for macOS ARM64...');
console.log(`📦 Version: ${finalVersion}`);
console.log(`📅 Build Date: ${BUILD_DATE}`);
console.log(`⏰ Build Time: ${BUILD_TIME}`);
console.log(`🗜️  Minification: ${MINIFY ? 'enabled' : 'disabled'}`);

// Build command
const buildArgs = [
  'build',
  '--compile',
  '--target=bun-darwin-arm64',
  `--define=BUILD_VERSION='"${finalVersion}"'`,
  `--define=BUILD_DATE='"${BUILD_DATE}"'`,
  `--define=BUILD_TIME='"${BUILD_TIME}"'`,
  './summarai.mjs',
  '--outfile', path.join(OUTPUT_DIR, 'summarai')
];

if (MINIFY) {
  buildArgs.splice(3, 0, '--minify');
}

try {
  // Run the build
  await $`bun ${buildArgs}`;
  
  console.log('✓ Build successful!');
  
  // Copy config.yaml to release directory
  console.log('Copying configuration files...');
  if (fs.existsSync('config.yaml')) {
    fs.copyFileSync('config.yaml', path.join(OUTPUT_DIR, 'config.yaml'));
    console.log('✓ Copied config.yaml');
  } else if (fs.existsSync('example.config.yaml')) {
    fs.copyFileSync('example.config.yaml', path.join(OUTPUT_DIR, 'config.yaml'));
    console.log('✓ Copied example.config.yaml as config.yaml');
  }
  
  // Copy context files that users can customize
  if (fs.existsSync('instructions.md')) {
    fs.copyFileSync('instructions.md', path.join(OUTPUT_DIR, 'instructions.md'));
    console.log('✓ Copied instructions.md');
  }
  
  if (fs.existsSync('nomenclature.txt')) {
    fs.copyFileSync('nomenclature.txt', path.join(OUTPUT_DIR, 'nomenclature.txt'));
    console.log('✓ Copied nomenclature.txt');
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
  const readme = `# summarai Executable

## Quick Start

This is a standalone executable version of summarai for macOS ARM64 (Apple Silicon).

### First Run on macOS

When running this executable for the first time, macOS will show a security warning:
"summarai cannot be opened because it is from an unidentified developer"

**To run it:**
1. Right-click (or Control-click) on \`summarai\`
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

3. **Customize Context Files (Optional)**
   - Edit \`instructions.md\` to customize Claude's processing instructions
   - Edit \`nomenclature.txt\` to add domain-specific terms and terminology
   - These files control how transcripts are processed and summarized

4. **Run the Executable**
   \`\`\`bash
   ./summarai
   \`\`\`

## Usage

### Basic Commands

\`\`\`bash
# Watch directories for new files
./summarai

# Process recent voice memos (last 120 days)
./summarai --process-recent-vm

# Process voice memos from specific date range
./summarai --process-recent-vm 1-1-25:1-31-25

# Process existing Google Drive files
./summarai --cleanout

# Show help and all options
./summarai --help
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

## Customizing Processing

### Context Files

You can customize how the application processes and summarizes your transcripts by editing these files:

#### \`instructions.md\`
Controls how Claude processes and summarizes transcripts. You can modify:
- Summary format and length requirements
- Keyword extraction rules  
- Action item identification
- Output formatting preferences

#### \`nomenclature.txt\`
Contains domain-specific terms and terminology that helps both transcription services and Claude:
- Company/product names (e.g., "Wolff", "ProPatch")
- Technical jargon and abbreviations
- Industry-specific terms
- Common replacements for misheard words

**How it works:**
- The application first checks for these files in the same directory as the executable
- If not found, it uses embedded default content
- This allows you to customize without breaking functionality

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
- Version: ${finalVersion}
- Build Date: ${BUILD_DATE}
- Build Time: ${BUILD_TIME}
- Platform: macOS ARM64 (Apple Silicon)
- Runtime: Bun (embedded)

## Support

For issues or questions, see the main project repository.
`;
  
  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), readme);
  console.log('✓ Created README.md');
  
  // Get file size
  const stats = fs.statSync(path.join(OUTPUT_DIR, 'summarai'));
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log('\\n📦 Build Summary:');
  console.log(`   📁 Output: ${OUTPUT_DIR}/`);
  console.log(`   📊 Version: ${finalVersion}`);
  console.log(`   💾 Executable size: ${sizeMB} MB`);
  console.log(`   📅 Build: ${BUILD_DATE} ${BUILD_TIME.split('T')[1].split('.')[0]}`);
  console.log(`   📄 Files in release directory:`);
  console.log(`   - summarai (executable)`);
  console.log(`   - config.yaml`);
  console.log(`   - instructions.md (customizable Claude prompts)`);
  console.log(`   - nomenclature.txt (customizable terminology)`);
  console.log(`   - .env.example`);
  console.log(`   - README.md`);
  
  // Create zip archive if requested
  if (CREATE_ZIP) {
    const archiveName = `summarai-macos-arm64-v${finalVersion}.zip`;
    console.log(`\\n📦 Creating distribution archive: ${archiveName}`);

    await $`cd release && zip -r ../${archiveName} .`;

    const archiveStats = fs.statSync(path.join(__dirname, archiveName));
    const archiveSizeMB = (archiveStats.size / (1024 * 1024)).toFixed(2);

    console.log(`✅ Created ${archiveName} (${archiveSizeMB} MB)`);
    console.log(`\\n📤 To distribute:`);
    console.log(`1. Share the ${archiveName} file`);
    console.log(`2. Users unzip and follow README instructions`);
  }
  
  console.log('\\n✅ Release package ready in ./release/');
  
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}