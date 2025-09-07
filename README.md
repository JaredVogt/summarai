# summarai - Audio Processing & Transcription System

A comprehensive system for automatically processing voice memos and audio/video files with transcription, summarization, and intelligent organization.

## ✨ Features

### Core Processing
- **Smart File Detection**: Lists recent voice memos sorted by date/time in filename (not modification time)
- **Rich Metadata**: Displays duration (mins:secs), recording date, and GPS info for each memo
- **Audio Optimization**: Always compresses files to optimized AAC format (configurable bitrate/sample rate) using ffmpeg
- **Video Support**: Automatic audio extraction from video files (MP4, MOV, AVI, MKV, WebM)
- **Multiple Transcription Services**: ElevenLabs Scribe (default) or OpenAI Whisper support
- **AI Summarization**: Claude-powered markdown summaries with configurable prompts

### Intelligent Organization  
- **Keyword-Based Routing**: Automatic file organization based on configurable keywords
- **Consistent Naming**: Output files use `YYYYMMDD_HH:MM:SS` format from original filename
- **Multiple Output Formats**: `.md` (summary), `.m4a` (compressed audio), `.txt` (raw transcription)
- **Directory Logic**: Files route to `output/` or `output/[keyword]/` based on first matching keyword

### Automation & Reliability
- **Automatic File Watching**: Monitors Voice Memos and Google Drive directories for new files
- **Retry Logic**: Exponential backoff for API reliability and error recovery
- **Silent Mode**: Fully automated processing without user interaction
- **Date Range Processing**: Flexible processing of Voice Memos from specific date ranges
- **Lock File System**: Prevents concurrent processing of the same file
- **Process History**: Tracks processed files to avoid duplicates

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
  voiceMemos: ~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings
  googleDrive:
    unprocessed: ~/path/to/unprocessed
    processed: ~/path/to/processed
  output: ~/path/to/output
  temp: ./temp

# File Processing
fileProcessing:
  supportedExtensions:
    audio: [.m4a, .mp3, .wav, .ogg, .flac]
    video: [.mp4, .mov, .avi, .mkv, .webm]
  ignore:
    patterns: [temp*, chunk_*, "*.processing"]

# Transcription Services
transcription:
  defaultService: scribe  # or whisper
  scribe:
    model: scribe_v1
    language: eng
    diarize: true
    tagAudioEvents: true
  whisper:
    model: whisper-1
    language: null  # auto-detect

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
```

### Environment Variable Overrides
Override any configuration setting using the format `PROCESSVM_SECTION_SUBSECTION_KEY`:

```bash
export PROCESSVM_DIRECTORIES_VOICEMEMOS="/custom/voice/memos/path"
export PROCESSVM_TRANSCRIPTION_DEFAULTSERVICE="whisper"
export PROCESSVM_AUDIO_PROCESSING_SPEEDADJUSTMENT="1.0"
```

### Customization Files
- **`keywords.txt`**: Controls output directory routing logic
- **`nomenclature.txt`**: Domain-specific terms for better transcription accuracy
- **`instructions.md`**: Claude prompt instructions and formatting rules

## 📋 Requirements

- **Node.js** v18+ recommended
- **ffmpeg** installed and available in PATH
- **API keys** for the services you want to use (Anthropic, ElevenLabs, OpenAI)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd summarai
   ```

2. **Install dependencies**
   ```bash
   npm install
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

- **Automatic Checking**: Checks Anthropic documentation for latest Opus 4 and Sonnet 4 models
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

## 🧩 Advanced Configuration Options

### Watch Behavior
```yaml
watch:
  enabled:
    voiceMemos: true
    googleDrive: true
  initialProcessing:
    cleanout: false
    processRecentVm: false
    defaultDateRange: 120  # days
  stability:
    threshold: 2000  # ms to wait for file stability
    pollInterval: 100
```

### API Configuration  
```yaml
api:
  retry:
    maxRetries: 3
    baseDelay: 1000
    maxDelay: 30000
  timeouts:
    scribe: 300
    claude: 120
    whisper: 180
```

### Processing Modes
```yaml
modes:
  silent:
    enabled: false
    suppressOutput: true
    autoConfirm: true
  dryRun:
    enabled: false
    showActions: true
```

## 🎯 Output Directory Logic

- **No keyword match**: Files → `output/`
- **Keyword match**: Files → `output/[first-matching-keyword]/`
- **No duplicates**: Files only written to one location
- **Batch consistency**: All related files (.md, .m4a, .txt) go to same directory

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

## 🔒 Security Features

The system includes comprehensive security measures:

- **Input Validation**: All user inputs are validated and sanitized
- **Path Security**: Protection against directory traversal attacks
- **Command Security**: All external commands use secure parameter passing
- **API Security**: Proper API key validation and handling
- **File Security**: Safe filename handling and size limits

## 📝 Recent Updates

- **v2.1**: Major security overhaul with comprehensive input validation and secure command execution
- **v2.0**: Complete configuration system overhaul with centralized YAML config
- **Enhanced Security**: Added path traversal protection and command injection prevention
- **Test Suite**: Comprehensive test coverage with 46+ passing tests
- **Error Handling**: Robust error handling framework with detailed logging
- **Bun Compatibility**: Full support for Bun runtime including VFS workarounds
- **Flexible Date Ranges**: Process Voice Memos from specific date ranges
- **Enhanced File Watching**: Improved stability and error handling
- **Video File Support**: Full support for extracting and processing audio from video files
- **Retry Logic**: Robust error recovery with exponential backoff
- **Silent Mode**: Fully automated processing capabilities
- **Model Checking**: Automatic monitoring for newer Claude models
- **Hardware Integration**: Sony IC Recorder sync utility with Keyboard Maestro support

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Update documentation as needed
5. Submit a pull request

## 📄 License

[Add your license information here]