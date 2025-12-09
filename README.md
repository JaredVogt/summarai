# summarai - Audio Processing & Transcription System

A comprehensive system for automatically processing voice memos and audio/video files with transcription, summarization, and intelligent organization.

## ✨ Features

### Core Processing
- **Smart File Detection**: Lists recent voice memos sorted by date/time in filename (not modification time)
- **Rich Metadata**: Displays duration (mins:secs), recording date, and GPS info for each memo
- **Audio Optimization**: Always compresses files to optimized AAC format (configurable bitrate/sample rate) using ffmpeg
- **Video Support**: Automatic audio extraction from video files (MP4, MOV, AVI, MKV, WebM)
- **Multiple Transcription Services**: ElevenLabs Scribe (default) or OpenAI Whisper support
- **Intelligent Transcript Formatting**: Advanced sentence-based segmentation with punctuation detection, natural pause recognition, and configurable thresholds for cleaner, more readable transcripts
- **AI Summarization**: Claude-powered markdown summaries with configurable prompts

### Intelligent Organization  
- **Keyword-Based Routing**: Automatic file organization based on configurable keywords
- **Consistent Naming**: Output files use `YYYYMMDD_HH:MM:SS` format from original filename
- **Multiple Output Formats**: `.md` (summary), `.m4a` (compressed audio), `.txt` (raw transcription)
- **Directory Logic**: Files route to `output/` or `output/[keyword]/` based on first matching keyword

### Automation & Reliability
- **Automatic File Watching**: Monitors Voice Memos and Google Drive directories for new files
- **Persistent Failure Tracking**: Failed files logged to NDJSON with automatic recovery on startup
- **Auto-Recovery System**: Orphaned lock file cleanup and failed file queue restoration
- **Retry Logic**: Exponential backoff for API reliability and configurable retry attempts (default: 3)
- **Silent Mode**: Fully automated processing without user interaction
- **Date Range Processing**: Flexible processing of Voice Memos from specific date ranges
- **Lock File System**: Prevents concurrent processing of the same file
- **Process History**: Tracks processed files to avoid duplicates with detailed metadata
- **iCloud File Validation**: Advanced readiness detection using `mdls` metadata and tail-read verification

### Security & Validation
- **Input Validation**: Comprehensive validation of all user inputs and file paths
- **Path Traversal Protection**: Prevents directory traversal and unauthorized file access
- **Secure Command Execution**: All external commands use secure parameter passing (no shell injection)
- **API Key Validation**: Automatic validation of required API keys on startup
- **File Size Limits**: Configurable limits to prevent resource exhaustion
- **Filename Sanitization**: Automatic cleaning of unsafe characters in filenames

### Advanced Features
- **Model Version Checking**: Automatically checks for newer Claude models with 24-hour caching
- **Flexible Audio Quality**: Normal (48k/16kHz) or low quality (24k/8kHz) compression options
- **Large File Chunking**: Automatic splitting of large audio files for processing
- **Configuration System**: Centralized YAML configuration with environment variable overrides
- **Speed Optimization**: Configurable audio speed adjustment (default 1.5x) for faster processing
- **Error Handling**: Comprehensive error handling with detailed logging and recovery mechanisms
- **Bun Runtime Support**: Full compatibility with Bun runtime including VFS-aware caching
- **Test Suite**: Comprehensive test coverage for validation, security, and functionality

## 📁 File Types Generated

- **`.md`**: Claude's markdown summary with metadata and structured content
- **`.m4a`**: Compressed audio copy optimized for storage
- **`.txt`**: Raw transcription output from the chosen service

## 🚀 Usage

### Configuration Setup
**Important**: The system now uses a centralized configuration file instead of scattered environment variables.

1. **Copy and customize configuration**:
   ```bash
   cp example.config.yaml config.yaml
   # Edit config.yaml with your specific paths and preferences
   ```

2. **Set up API keys** in `~/.env` (your home directory):
   ```bash
   ANTHROPIC_API_KEY=your-anthropic-api-key
   ELEVENLABS_API_KEY=your-elevenlabs-api-key  
   OPENAI_API_KEY=your-openai-api-key
   ```

### Interactive Mode
```bash
node transcribe.mjs
```
1. Choose how many recent memos to display
2. Select a file to transcribe
3. Files are automatically organized based on keywords

### Command Line Options
```bash
# Process a specific file
node transcribe.mjs --file /path/to/audio.m4a

# Choose transcription service
node transcribe.mjs --service whisper
node transcribe.mjs --service scribe

# Use low quality compression (faster processing)
node transcribe.mjs --low

# Run in silent mode (no prompts)
node transcribe.mjs --silent
```

### Automatic File Watching
Monitor directories for new files and process them automatically:

```bash
# Basic watching
node summarai.mjs

# Process all existing Google Drive files first, then watch
node summarai.mjs --cleanout

# Process recent Voice Memos from last 120 days (configurable)
node summarai.mjs --process-recent-vm

# Process Voice Memos from specific date range
node summarai.mjs --process-recent-vm 7-1-25        # July 1, 2025 to now
node summarai.mjs --process-recent-vm 4-1-25:5-31-25  # April 1 to May 31, 2025

# Dry run to see what would be processed
node summarai.mjs --process-recent-vm --dry-run

# Show all available options
node summarai.mjs --help
```

## ⚙️ Configuration

### Primary Configuration File (`config.yaml`)
The system uses a comprehensive YAML configuration file that controls all aspects of operation:

```yaml
# Directory Configuration
directories:
  # Watch directories with per-directory settings
  watch:
    voiceMemos:
      name: "Voice Memos"
      path: ~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings
      enabled: true
      moveAfterProcessing: false    # Keep files in place after processing
      outputPath: ~/path/to/output  # Where to save transcripts
      transcriptionService: scribe  # Service to use for this directory
      compress: true                # Compress audio files

    googleDrive:
      name: "Google Drive Unprocessed"
      path: ~/path/to/unprocessed
      enabled: true
      moveAfterProcessing: true     # Move processed files
      processedPath: ~/path/to/processed  # Where to move processed audio
      outputPath: ~/path/to/output  # Where to save transcripts
      transcriptionService: scribe  # Service for this directory
      compress: true

  temp: ./temp

# File Processing
fileProcessing:
  supportedExtensions:
    audio: [.m4a, .mp3, .wav, .ogg, .flac]
    video: [.mp4, .mov, .avi, .mkv, .webm]
  output:
    createSegmentsFile: false  # Toggle separate .txt transcript files
  ignore:
    patterns: [temp*, chunk_*, "*.processing"]

# Transcription Services
transcription:
  defaultService: scribe  # or whisper
  scribe:
    model: scribe_v1_experimental  # or scribe_v1
    language: eng
    diarize: true
    tagAudioEvents: true
  whisper:
    model: whisper-1
    language: null  # auto-detect

# Processing Configuration
processing:
  # Transcript formatting settings
  sentence_pause_threshold: 0.8  # seconds - gap between words to split segments
  max_words_per_segment: 50      # maximum words per segment

# Audio Processing
audio:
  compression:
    normal:
      bitrate: 48k
      sampleRate: 16000
    low:
      bitrate: 24k
      sampleRate: 8000
  processing:
    speedAdjustment: 1.5
    codec: aac
    channels: 1

# Claude Configuration
claude:
  model: claude-sonnet-4-5-20250929  # Latest Sonnet 4.5
```

### Environment Variable Overrides
Override any configuration setting using the format `PROCESSVM_SECTION_SUBSECTION_KEY`:

```bash
export PROCESSVM_DIRECTORIES_VOICEMEMOS="/custom/voice/memos/path"
export PROCESSVM_TRANSCRIPTION_DEFAULTSERVICE="whisper"
export PROCESSVM_AUDIO_PROCESSING_SPEEDADJUSTMENT="1.0"
```

## 🧾 Processed Files Log (NDJSON)

- Location: configured at `fileProcessing.history.file` (default `./processed_log.ndjson`).
- Format: append-only NDJSON (one JSON object per line). Safer than an in-memory JSON array and robust to crashes.
- Dedup key: the original, date-stamped filename. We check by `sourceName` (the basename of the source file). Destination names are never used for dedup.
- Also tracked for audit/debug: `sourcePath` (absolute path), destination path(s), sizes, and service/model.

Fields per record:
- `processedAt` (ISO string)
- `sourcePath` (absolute path including original filename)
- `sourceName` (original basename; used for dedup checks)
- `destAudioPath` (nullable; final audio location if the file was moved, e.g., Google Drive flow)
- `outputMdPath` (nullable; path to the generated markdown summary)
- `service` (e.g., `scribe` or `whisper`)
- `model` (e.g., `scribe_v1`, `whisper-1`)
- `sizeSourceBytes` (integer)
- `sizeDestBytes` (integer, nullable)

Example line:
```
{"processedAt":"2025-09-16T18:01:23Z","sourcePath":"/Users/me/Drive/unprocessed/VM-20250916_175959.m4a","sourceName":"VM-20250916_175959.m4a","destAudioPath":"/Users/me/Drive/processed/2025-09-16-180123.m4a","outputMdPath":"/Users/me/VMs/2025-09-16-180123.md","service":"scribe","model":"scribe_v1","sizeSourceBytes":12345678,"sizeDestBytes":4567890}
```

Migration from legacy JSON array:
- If `processed_log.ndjson` does not exist but a legacy `process_history.json` is found, it is migrated automatically on first read.
- Legacy entries become NDJSON rows with `sourceName` and `processedAt`; other fields are null.

### Customization Files
- **`keywords.txt`**: Controls output directory routing logic
- **`nomenclature.txt`**: Domain-specific terms for better transcription accuracy
- **`instructions.md`**: Claude prompt instructions and formatting rules

## 📋 Requirements

- **Node.js** v18+ or **Bun** runtime
- **ffmpeg** installed and available in PATH
- **API keys** for the services you want to use (Anthropic, ElevenLabs, OpenAI)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd summarai
   ```

2. **Install dependencies**

   Using npm:
   ```bash
   npm install
   ```

   Or using Bun (faster, recommended):
   ```bash
   bun install
   ```

3. **Set up configuration**
   ```bash
   # Copy and edit configuration
   cp example.config.yaml config.yaml
   # Edit config.yaml with your paths and preferences
   
   # Create API keys file
   echo "ANTHROPIC_API_KEY=your-key-here" >> ~/.env
   echo "ELEVENLABS_API_KEY=your-key-here" >> ~/.env
   echo "OPENAI_API_KEY=your-key-here" >> ~/.env
   ```

4. **Customize processing rules** (optional)
   ```bash
   # Edit keyword routing
   nano keywords.txt
   
   # Add domain-specific terms
   nano nomenclature.txt
   
   # Customize Claude instructions
   nano instructions.md
   ```

## 🔄 Migration from Previous Version

If you're upgrading from a version that used `.env` files for configuration:

### Automatic Migration
The system automatically falls back to environment variables if configuration cannot be loaded, providing seamless compatibility.

### Manual Migration
1. **Review your existing `.env` files** and note your current settings
2. **Copy the example configuration**: `cp example.config.yaml config.yaml` 
3. **Transfer your settings** to the appropriate sections in `config.yaml`
4. **Test the configuration**: `node -e "import('./configLoader.mjs').then(({loadConfig}) => console.log('✓ Config loaded:', !!loadConfig()))"`

### Key Changes
- **Directory paths** moved from `GOOGLE_DRIVE_*` env vars to `config.yaml`
- **API settings** (timeouts, retries) now in `config.yaml` 
- **Audio processing** settings centralized in `config.yaml`
- **File extensions** and ignore patterns now configurable
- **Environment variables** still work as overrides using `PROCESSVM_*` format

## 🤖 Model Version Checking

The system automatically monitors for newer Claude model versions:

- **Automatic Checking**: Checks Anthropic documentation for latest Opus 4/4.5 and Sonnet 4/4.5 models
- **Smart Caching**: Results cached for 24 hours to minimize API requests  
- **Non-blocking**: Runs asynchronously without affecting transcription speed
- **Configurable Model**: Set your preferred model in the configuration

### Manual Model Checking
```bash
# Check with current model
node modelChecker.mjs

# Test with specific model
node modelChecker.mjs claude-opus-4-20250101
```

### Switching Models
Set the Claude model in `config.yaml` under the `claude.model` key.

```yaml
# config.yaml
claude:
  # Choose one of the following model IDs:
  # - Latest Opus 4.5:   claude-opus-4-5-20251101 (most capable)
  # - Latest Sonnet 4.5: claude-sonnet-4-5-20250929 (current default)
  # - Latest Sonnet 4:   claude-sonnet-4-20250514
  # - Latest Opus 4:     claude-opus-4-20250514
  model: claude-sonnet-4-5-20250929
```

- To switch, replace the `model` value and save the file.
- The built-in checker logs when newer Sonnet/Opus versions are available, but it does not auto-update your config.
- You can run `node modelChecker.mjs` anytime to see what's current.

## 📊 ElevenLabs Subscription Monitoring

The system includes real-time monitoring of your ElevenLabs API usage when using Scribe transcription:

### Features
- **Live Character Tracking**: Displays current usage vs. subscription limits
- **Visual Status Indicators**:
  - 🟢 Green: Under 50% usage
  - 🟡 Yellow: 50-80% usage
  - 🔴 Red: Over 80% usage
- **Reset Time Display**: Shows when your quota resets
- **Automatic Updates**: Refreshes usage data during transcription

### Example Output
```
ElevenLabs Subscription Status:
🟢 Characters used: 45,230 / 100,000 (45.2%)
⏰ Resets in: 12 days, 3 hours
```

### Warnings
The system will warn you when approaching limits:
- **80% usage**: Yellow warning with remaining characters
- **90% usage**: Red warning suggesting usage review
- **95%+ usage**: Critical warning - consider upgrading or waiting for reset

### Manual Check
```bash
# Check subscription status anytime
node elevenLabsMonitor.mjs
```

## 🧩 Advanced Configuration Options

### Per-Directory Configuration

Each watch directory can have independent settings:

```yaml
directories:
  watch:
    voiceMemos:
      name: "Voice Memos"
      path: ~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings
      enabled: true                  # Enable/disable watching this directory
      moveAfterProcessing: false     # Keep files in original location
      outputPath: ~/Obsidian/VMs     # Where to save transcripts
      transcriptionService: scribe   # Use ElevenLabs for this directory
      compress: true                 # Compress audio files

    googleDrive:
      name: "Google Drive"
      path: ~/GoogleDrive/unprocessed
      enabled: true
      moveAfterProcessing: true      # Move files after processing
      processedPath: ~/GoogleDrive/processed  # Destination for processed audio
      outputPath: ~/Obsidian/VMs
      transcriptionService: whisper  # Use OpenAI Whisper for this directory
      compress: false                # Keep original quality
```

**Use Cases:**
- Different transcription services for different audio sources
- Separate quality settings (compress personal memos, keep work recordings at full quality)
- Different output destinations (personal vs. work content)
- Mix of move and keep-in-place behaviors

### Watch Behavior
```yaml
watch:
  # Initial processing on startup
  initialProcessing:
    cleanout: false              # Process all existing files
    processRecentVm: false       # Process recent voice memos
    defaultDateRange: 120        # Days to look back

  # File stability detection
  stability:
    threshold: 2000              # ms to wait for file stability
    pollInterval: 100            # ms between stability checks
    tailRead: true               # Verify file is fully readable
    mdlsCheck: true              # Use macOS metadata checks (iCloud)

  # File validation
  validation:
    enabled: true                # Enable file integrity checks
    level: standard              # Options: basic, standard, thorough
    retries: 3                   # Retry attempts for failed validation

  # Queue processing
  queue:
    delayBetweenFiles: 2000      # ms delay between files
    initialDelay: 5000           # ms before processing new file
```

### API Configuration
```yaml
api:
  retry:
    maxRetries: 3                # Max retry attempts
    baseDelay: 1000              # Initial delay (ms)
    maxDelay: 30000              # Maximum delay (ms)
    retryDelays: [5000, 15000, 30000]  # Specific delays for each retry

  timeouts:
    scribe: 300                  # ElevenLabs timeout (seconds)
    claude: 120                  # Claude API timeout
    whisper: 180                 # OpenAI Whisper timeout
```

### Processing Modes
```yaml
modes:
  silent:
    enabled: false               # Silent mode by default
    suppressOutput: true         # Hide console output
    autoConfirm: true            # Auto-confirm prompts

  dryRun:
    enabled: false               # Dry run mode
    showActions: true            # Show planned actions
```

### File Processing Options
```yaml
fileProcessing:
  output:
    createSegmentsFile: false    # Create separate .txt transcript files
                                 # Set to true for .txt files, false for .md only

  history:
    enabled: true                # Track processed files
    file: ./processed_log.ndjson # NDJSON log file path

  ignore:
    patterns:
      - temp*                    # Ignore temp files
      - chunk_*                  # Ignore chunks
      - "*.processing"           # Ignore lock files
```

## 🎯 Output Directory Logic

- **No keyword match**: Files → `output/`
- **Keyword match**: Files → `output/[first-matching-keyword]/`
- **No duplicates**: Files only written to one location
- **Batch consistency**: All related files (.md, .m4a, .txt) go to same directory

## 📝 Advanced Transcript Formatting

The system uses intelligent sentence-based segmentation to create clean, readable transcripts optimized for AI processing and human readability.

### How It Works

**Segmentation Algorithm:**
1. **Sentence Boundary Detection**: Splits on punctuation (`.!?`) at word endings
2. **Natural Pause Recognition**: Detects speech gaps exceeding the threshold (default: 0.8s)
3. **Length Management**: Prevents overly long segments (default: 50 words max)
4. **Text Normalization**: Cleans whitespace with `replace(/\s+/g, ' ').trim()` for consistent formatting

**Speaker Handling:**
- Extracts numeric IDs from "speaker_0" format
- Formats as "Speaker 0", "Speaker 1", etc.
- Preserves speaker identity across segment boundaries

### Configuration

```yaml
processing:
  # Gap between words to trigger segment split
  sentence_pause_threshold: 0.8  # seconds (default: 0.8)

  # Maximum words per segment
  max_words_per_segment: 50      # words (default: 50)
```

### Benefits

**For AI Processing:**
- Natural reading flow improves Claude's comprehension
- Consistent formatting aids pattern recognition
- Cleaner text reduces parsing overhead
- Proper sentence boundaries improve summarization quality

**For Human Readers:**
- Easy-to-read segments with natural breaks
- Speaker identification at each segment
- Logical grouping of related thoughts
- Reduced wall-of-text effect

### Example Output

**Before (raw):**
```
Speaker 0: So I've been thinking about the project and I think we should probably consider changing the architecture maybe we could use a microservices approach what do you think?
```

**After (formatted):**
```
Speaker 0: So I've been thinking about the project and I think we should probably consider changing the architecture.

Speaker 0: Maybe we could use a microservices approach. What do you think?
```

### Tuning Parameters

- **Lower threshold (e.g., 0.5s)**: More aggressive splitting, shorter segments
- **Higher threshold (e.g., 1.2s)**: Longer segments, fewer breaks
- **Lower max words (e.g., 30)**: Forces shorter segments for rapid speech
- **Higher max words (e.g., 75)**: Allows longer thoughts to stay together

## 🔧 Troubleshooting

### Configuration Issues
```bash
# Test configuration loading
node -e "import('./configLoader.mjs').then(({loadConfig}) => {try {console.log('✓ Config loaded successfully');} catch(e) {console.error('✗ Config error:', e.message);}})"

# View parsed configuration
node -e "import('./configLoader.mjs').then(({loadConfig}) => console.log(JSON.stringify(loadConfig(), null, 2)))"
```

### Common Issues
- **"Configuration file not found"**: Ensure `config.yaml` exists in project root
- **"Invalid YAML"**: Check YAML syntax, especially array formatting with `- `
- **"Directory not found"**: Update directory paths in `config.yaml` to match your system
- **API errors**: Verify API keys are correctly set in `~/.env`

### iCloud File Issues
If files from iCloud Drive aren't processing correctly:

1. **Check file readiness**: The system uses `mdls` to verify files are fully downloaded
2. **Verify download status**: Look for log messages about file hydration
3. **Wait for sync**: Files may show in Finder but not be physically downloaded yet
4. **Manual check**: Run `mdls <file>` to see metadata - `kMDItemLogicalSize` should match physical size

The system automatically:
- Validates files using macOS metadata before processing
- Performs tail-read verification to ensure full file availability
- Retries with configurable delays if files aren't ready
- Skips iCloud validation on non-macOS systems

## 🔄 Failure Recovery & Reliability

### Automatic Recovery System
The system includes comprehensive failure tracking and auto-recovery:

**On Startup:**
- Detects and cleans up orphaned `.processing` lock files from interrupted sessions
- Restores failed files queue from `processed_log.ndjson`
- Automatically retries previously failed files

**During Processing:**
- Logs all failures to NDJSON with error details and retry count
- Uses exponential backoff for transient errors (5s, 15s, 30s delays)
- Maximum 3 retry attempts per file (configurable)
- Preserves original files on failure

**Viewing Failed Files:**
```bash
# Check for failed files in the log
grep '"error"' processed_log.ndjson

# Count failures
grep '"error"' processed_log.ndjson | wc -l
```

### Process History
All processing attempts (successful and failed) are logged to `processed_log.ndjson`:

**Success Record:**
```json
{
  "processedAt": "2025-01-23T18:01:23Z",
  "sourcePath": "/path/to/VM-20250123.m4a",
  "sourceName": "VM-20250123.m4a",
  "service": "scribe",
  "model": "scribe_v1_experimental",
  "sizeSourceBytes": 12345678
}
```

**Failure Record:**
```json
{
  "processedAt": "2025-01-23T18:01:23Z",
  "sourcePath": "/path/to/VM-20250123.m4a",
  "sourceName": "VM-20250123.m4a",
  "error": "Transcription failed: API timeout",
  "retryCount": 2
}
```

## 🔌 Hardware Integration

### Sony IC Recorder Sync
Included utility script for automatically importing audio files from Sony IC Recorders:

```bash
# Manual sync
./sync_sony.sh

# Automated sync via Keyboard Maestro (recommended)
# - Set up KM macro triggered by USB device connection
# - Configure macro to run sync_sony.sh automatically
# - Files are copied to input_files/ directory for processing
```

**Features:**
- **Automatic detection** of Sony IC Recorder when connected via USB
- **Duplicate prevention** - only copies new files not already in destination
- **Logging** - maintains a log of all copied files
- **Keyboard Maestro integration** - designed for automated triggering

**Configuration:** Edit paths in `sync_sony.sh` to match your setup:
```bash
SOURCE_DIR="/Volumes/IC RECORDER/REC_FILE/FOLDER01"  # Sony device path
DEST_DIR="/path/to/your/input_files"                # Local destination
LOG_FILE="/path/to/your/.move_log"                  # Copy log file
```

## 🧪 Testing & Development

### Running Tests
```bash
# Run all tests
bun test

# Run specific test suites
bun test tests/validation.test.mjs
bun test tests/basic-functionality.test.mjs

# Test Bun compatibility
bun scripts/test-bun-compatibility.mjs

# Validate critical fixes
bun test-critical-fixes.mjs
```

### Test Coverage
- **Validation Tests**: Input validation, security, and sanitization
- **Functionality Tests**: Core features, error handling, file operations
- **Security Tests**: Path traversal protection, command injection prevention
- **Integration Tests**: End-to-end workflows and error scenarios

## 🚢 Build & Deployment

The system includes comprehensive build tooling for creating standalone executables:

### Build Commands

```bash
# Basic build (creates executable)
npm run build

# Build with minification
npm run build:minified

# Build, minify, and create zip archive
npm run build:zip

# Version bump + build (patch: 1.0.0 → 1.0.1)
npm run build:patch

# Minor version bump (1.0.0 → 1.1.0)
npm run build:minor

# Major version bump (1.0.0 → 2.0.0)
npm run build:major

# Quick release (patch bump + minify + zip)
npm run release
```

### Version Management

**Check current version:**
```bash
npm run version
# Or use the CLI flag:
node summarai.mjs --version
```

**Build process includes:**
- Automatic version incrementing (when using `--increment` flags)
- Running test suite before build (prebuild hook)
- Minification of JavaScript code (with `--minify`)
- Compression into distributable ZIP (with `--zip`)
- Standalone executable creation via Bun

### Distribution

The build process creates:
- **Executable**: `./dist/summarai` (or `summarai.exe` on Windows)
- **Archive**: `./release/summarai-v{version}.zip` (when using `--zip`)

**Distribution locations:**
- `./dist/`: Uncompressed build output
- `./release/`: Compressed archives for distribution

### Deployment Options

1. **Local Installation**: Copy executable to `/usr/local/bin` or similar
2. **Shared Distribution**: Use ZIP archive from `./release/`
3. **Package Manager**: Executable can be integrated with package managers
4. **Docker**: Can be containerized with runtime dependencies (ffmpeg, etc.)

## 🔒 Security Features

The system includes comprehensive security measures:

- **Input Validation**: All user inputs are validated and sanitized
- **Path Security**: Protection against directory traversal attacks
- **Command Security**: All external commands use secure parameter passing
- **API Security**: Proper API key validation and handling
- **File Security**: Safe filename handling and size limits

## 📝 Recent Updates

### v2.2.4 (Current)
- **Persistent Failure Tracking**: Failed files logged to NDJSON with automatic recovery on startup
- **Auto-Recovery System**: Orphaned lock file cleanup and failed file queue restoration
- **Claude Sonnet 4.5**: Upgraded to latest model (`claude-sonnet-4-5-20250929`) for improved summarization
- **Enhanced iCloud Validation**: Advanced file readiness detection using `mdls` metadata and tail-read verification
- **ElevenLabs Subscription Monitoring**: Real-time API usage tracking with character limit warnings
- **Advanced Transcript Formatting**: Intelligent sentence-based segmentation with configurable pause thresholds
- **Per-Directory Configuration**: Independent transcription service and processing settings per watch directory
- **File Integrity Checks**: `moov atom` detection for MP4/M4A files with corruption detection
- **Configurable Segments Output**: Optional toggle for creating separate `.txt` transcript files

### v2.1
- Major security overhaul with comprehensive input validation and secure command execution
- Enhanced Security: Added path traversal protection and command injection prevention
- Test Suite: Comprehensive test coverage with 46+ passing tests
- Error Handling: Robust error handling framework with detailed logging

### v2.0
- Complete configuration system overhaul with centralized YAML config
- Bun Compatibility: Full support for Bun runtime including VFS workarounds
- Flexible Date Ranges: Process Voice Memos from specific date ranges
- Enhanced File Watching: Improved stability and error handling
- Video File Support: Full support for extracting and processing audio from video files
- Retry Logic: Robust error recovery with exponential backoff
- Silent Mode: Fully automated processing capabilities
- Model Checking: Automatic monitoring for newer Claude models
- Hardware Integration: Sony IC Recorder sync utility with Keyboard Maestro support

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Update documentation as needed
5. Submit a pull request

## 📄 License

[Add your license information here]
