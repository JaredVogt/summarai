# Bun Executable Build Plan for watchDirectories

## Overview
Compile watchDirectories into a standalone executable for macOS Apple Silicon (ARM64) using Bun's built-in compilation features. The executable will bundle all code and dependencies while keeping config.yaml and .env as external configuration files.

## Target Platform
- **Platform**: macOS Apple Silicon (ARM64)
- **Target**: `bun-darwin-arm64`

## How It Works
The compiled executable will be a single binary file (~50-80MB) containing:
- All JavaScript/TypeScript code from the project
- All npm dependencies (chokidar, axios, dotenv, form-data, @elevenlabs/elevenlabs-js)
- The Bun runtime itself

External files (user-configurable):
- `config.yaml` - Configuration settings
- `.env` - API keys and environment variables

The executable will look for these configuration files in its current working directory, allowing users to modify settings without recompiling.

## Implementation Tasks

### Task 1: Create package.json
Create a proper package.json file to manage dependencies and build scripts.

**File**: `package.json`
```json
{
  "name": "watchdirectories",
  "version": "1.0.0",
  "description": "Voice memo and audio file processor with automatic transcription",
  "main": "watchDirectories.mjs",
  "type": "module",
  "scripts": {
    "start": "bun watchDirectories.mjs",
    "build": "bun run build-executable.mjs",
    "build:minified": "bun run build-executable.mjs --minify",
    "test": "bun test"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "chokidar": "^3.5.3",
    "dotenv": "^16.3.1",
    "form-data": "^4.0.0",
    "@elevenlabs/elevenlabs-js": "^0.1.0"
  },
  "engines": {
    "bun": ">=1.0.0"
  }
}
```

### Task 2: Modify configLoader.mjs
Update the config loader to handle paths correctly when running as a compiled executable.

**Changes needed in** `configLoader.mjs`:
```javascript
// Add at the top of the file
const isExecutable = process.argv[1]?.endsWith('watchDirectories') || 
                     process.argv[1]?.endsWith('watchDirectories.exe');

// Modify CONFIG_PATHS to check current working directory first
const CONFIG_PATHS = [
  // Priority 1: Current working directory (for executable)
  path.join(process.cwd(), 'config.yaml'),
  // Priority 2: Script directory (for development)
  path.join(__dirname, 'config.yaml'),
  // Priority 3: Parent directory
  path.join(__dirname, '..', 'config.yaml'),
];

// Similarly update .env loading logic
function loadEnvFile() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env'),
  ];
  
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return;
    }
  }
}
```

### Task 3: Create Build Script
Create a build script that compiles the executable and packages it in a release directory.

**File**: `build-executable.mjs`
```javascript
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
- Runtime: Bun ${process.version}

## Support

For issues or questions, see the main project repository.
`;
  
  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), readme);
  console.log('✓ Created README.md');
  
  // Get file size
  const stats = fs.statSync(path.join(OUTPUT_DIR, 'watchDirectories'));
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log('\n📦 Build Summary:');
  console.log(`   Output: ${OUTPUT_DIR}/`);
  console.log(`   Executable size: ${sizeMB} MB`);
  console.log(`   Files in release directory:`);
  console.log(`   - watchDirectories (executable)`);
  console.log(`   - config.yaml`);
  console.log(`   - .env.example`);
  console.log(`   - README.md`);
  console.log('\n✅ Release package ready in ./release/');
  
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
```

### Task 4: Optional - Create Distribution Archive
Create a compressed archive for easier distribution.

**Add to build-executable.mjs (optional step):**
```javascript
// After successful build, optionally create a zip archive
if (process.argv.includes('--zip')) {
  const archiveName = `watchDirectories-macos-arm64-v${VERSION}.zip`;
  console.log(`\nCreating distribution archive: ${archiveName}`);
  
  await $`cd release && zip -r ../${archiveName} .`;
  
  const archiveStats = fs.statSync(path.join(__dirname, archiveName));
  const archiveSizeMB = (archiveStats.size / (1024 * 1024)).toFixed(2);
  
  console.log(`✓ Created ${archiveName} (${archiveSizeMB} MB)`);
  console.log(`\nTo distribute:`);
  console.log(`1. Share the ${archiveName} file`);
  console.log(`2. Users unzip and follow README instructions`);
}
```

## Execution Steps

### Phase 1: Preparation
1. [ ] Install Bun if not already installed: `curl -fsSL https://bun.sh/install | bash`
2. [ ] Ensure all dependencies are installed: `bun install`
3. [ ] Test the application works normally: `bun watchDirectories.mjs --help`

### Phase 2: Code Modifications
1. [ ] Create `package.json` with dependencies and scripts
2. [ ] Update `configLoader.mjs` to handle executable paths correctly
3. [ ] Create `build-executable.mjs` build script
4. [ ] Test configuration loading with modified paths

### Phase 3: Build Process
1. [ ] Run the build script: `bun run build`
2. [ ] Verify executable was created in `release/`
3. [ ] Check executable size (should be 40-80MB)
4. [ ] Verify all files in release directory:
   - [ ] watchDirectories (executable)
   - [ ] config.yaml
   - [ ] .env.example
   - [ ] README.md

### Phase 4: Testing
1. [ ] Navigate to the release directory: `cd release`
2. [ ] Set up `.env` from `.env.example`
3. [ ] Verify config.yaml has correct paths
4. [ ] Test the Gatekeeper override (right-click → Open)
5. [ ] Test all command-line options:
   - [ ] Basic watching mode
   - [ ] `--process-recent-vm`
   - [ ] `--cleanout`
   - [ ] `--dry-run`
6. [ ] Verify file processing works correctly
7. [ ] Check that config changes are respected

### Phase 5: Distribution (Optional)
1. [ ] Create zip archive: `bun run build --zip`
2. [ ] Share the `watchDirectories-macos-arm64-v1.0.0.zip` file
3. [ ] Users unzip and follow the README instructions
4. [ ] No code signing needed - users will use right-click → Open method

## Benefits

### For Development
- Keep using the source files normally with `bun watchDirectories.mjs`
- Build executable anytime with `bun run build`
- Version control friendly - build script is part of the repo

### For Distribution
- **Single file**: Users get one executable, no Node.js/Bun installation needed
- **Fast startup**: No npm install, instant execution
- **Portable**: Copy executable anywhere with config files
- **Easy updates**: Replace executable, keep configuration

### For Users
- Download and run - no technical setup required
- Modify config.yaml and .env without recompiling
- Consistent behavior across different environments
- No dependency conflicts or version issues

## File Size Management

Expected sizes:
- **Unminified**: ~70-80MB (includes full Bun runtime)
- **Minified**: ~50-60MB (with `--minify` flag)
- **Compressed**: ~20-25MB (when zipped for distribution)

To reduce size further:
1. Use `--minify` flag during build
2. Remove unused dependencies
3. Compress for distribution (.tar.gz or .zip)

## Troubleshooting

### Common Issues

1. **"Cannot find config.yaml"**
   - Ensure config.yaml is in the same directory as the executable
   - Check file permissions

2. **"Missing API keys"**
   - Copy `.env.example` to `.env`
   - Add your API keys to `.env`

3. **"Illegal instruction" error**
   - Wrong architecture (using Intel binary on Apple Silicon)
   - Rebuild for correct platform

4. **Gatekeeper warning on macOS**
   - Right-click and select "Open" for first run
   - Or code sign the executable

## Future Enhancements

1. **Auto-update mechanism**: Check for new versions and self-update
2. **GUI wrapper**: Create a simple GUI using Electron or Tauri
3. **Multi-platform builds**: Add Linux and Windows support
4. **Installer packages**: Create .dmg for macOS, .msi for Windows
5. **Configuration wizard**: Interactive setup for first-time users

## Conclusion

This plan provides a complete solution for compiling watchDirectories into a standalone executable for macOS ARM64. The executable will be self-contained except for configuration files, making it easy to distribute and maintain while keeping user settings separate from the code.