# Changelog

All notable changes to the Voice Memo Processing & Transcription Workflow project are documented in this file.

## [2.2.4] - 2025-09-20 - Enhanced Transcript Formatting

### 🎯 Transcript Quality Improvements
- **Intelligent Sentence Segmentation**: Replaced simple speaker-based segmentation with advanced sentence-based formatting
- **Natural Pause Detection**: Configurable pause threshold (0.8s default) for detecting natural speech breaks
- **Punctuation-Based Boundaries**: Automatic sentence detection using punctuation patterns (.!?)
- **Text Cleaning**: Enhanced whitespace normalization and word trimming for cleaner output
- **Configurable Limits**: Maximum words per segment (50 default) to prevent overly long segments

### 🔧 Configuration Enhancements
- **New Processing Section**: Added `processing.sentence_pause_threshold` and `processing.max_words_per_segment` configuration options
- **Improved Readability**: Maintains speaker identification while optimizing for natural reading flow
- **Backward Compatibility**: All existing configurations remain functional

### 📈 Benefits
- More natural reading flow with proper sentence boundaries
- Consistent spacing and punctuation handling
- Better speaker attribution without losing readability
- Configurable segmentation for different use cases

### 🔄 Technical Changes
- Enhanced `formatScribeResult()` function with `createSentenceSegments()` logic
- Integrated yt2s project's advanced formatting capabilities
- Preserved all existing API compatibility and verbose mode support

---

## [2.1.0] - 2025-09-05 - Security & Reliability Overhaul

### 🔒 Major Security Improvements
- **Command Injection Prevention**: All external commands (FFmpeg/FFprobe) now use secure parameter passing
- **Input Validation Framework**: Comprehensive validation for all user inputs and file paths
- **Path Traversal Protection**: Robust protection against directory traversal attacks
- **API Key Security**: Automatic validation of required API keys on startup
- **Filename Sanitization**: Safe handling of user-provided filenames

### 🛡️ New Security Features
- **Validation Module** (`src/validation.mjs`): Centralized input validation and sanitization
- **Error Handling Framework** (`src/errors.mjs`): Consistent error handling with detailed logging
- **Secure Command Execution**: Replaced shell command interpolation with spawn-based execution
- **File Size Limits**: Configurable limits to prevent resource exhaustion
- **Security Test Suite**: Comprehensive tests for all security features

### 🧪 Testing Infrastructure
- **Complete Test Suite**: 46+ passing tests covering validation, security, and functionality
- **Bun Compatibility Tests**: Full support for Bun runtime including VFS workarounds
- **Security Tests**: Path traversal, command injection, and input validation testing
- **Integration Tests**: End-to-end workflow testing with error scenarios
- **Continuous Validation**: Automated testing of critical security features

### 🚀 Reliability Improvements
- **Enhanced Error Handling**: Graceful error recovery with detailed context logging
- **Bun VFS Compatibility**: Memory-based caching for Bun executable compatibility
- **Input Sanitization**: All user inputs are validated and sanitized before processing
- **Resource Management**: Proper cleanup and resource limit enforcement

### 📚 Documentation Updates
- **Security Documentation**: Comprehensive security feature documentation
- **Testing Guide**: Instructions for running and extending the test suite
- **Migration Notes**: Security-related breaking changes and migration guidance

---

## [2.0.0] - 2025-08-29 - Configuration System Overhaul

### 🎉 Major Features
- **Centralized Configuration System**: Complete migration from environment variables to YAML-based configuration
  - Single `config.yaml` file controls all system behavior
  - `example.config.yaml` with comprehensive documentation
  - Automatic fallback to environment variables for backward compatibility
  - Configuration validation with helpful error messages

### ✨ New Configuration Options
- **Directory Management**: Configurable paths for all input/output directories
- **File Processing**: Customizable supported extensions and ignore patterns  
- **Audio Processing**: Configurable compression settings, codecs, and quality levels
- **Watch Behavior**: Tunable file stability thresholds and processing delays
- **API Settings**: Centralized timeout and retry configurations
- **Processing Modes**: Silent mode, dry run, and batch processing options

### 🔧 Advanced Features
- **Environment Variable Overrides**: `PROCESSVM_*` format for deployment-specific settings
- **Path Expansion**: Automatic `~` to home directory expansion
- **Custom YAML Parser**: No external dependencies for configuration parsing
- **Hot Configuration**: Changes take effect on service restart

### 📚 Documentation Updates
- Complete README.md rewrite with new configuration instructions
- Migration guide (`MIGRATION.md`) for existing users
- Troubleshooting section with configuration validation commands
- Examples for all major use cases and deployment scenarios

### 🔄 Migration Support
- **Seamless Backward Compatibility**: Existing `.env` setups continue working
- **Gradual Migration**: Users can migrate settings incrementally
- **Validation Tools**: Built-in configuration testing and debugging commands

---

## [1.8.0] - 2025-08-24 - Flexible Date Range Processing

### ✨ New Features
- **Flexible Date Range Support**: Enhanced `--process-recent-vm` with multiple format options
  - Default: Last 120 days (configurable)
  - Single date: From date to now (`7-23-25`)
  - Date range: Specific range (`4-1-25:5-31-25`)
- **Enhanced Dry Run Mode**: Shows processed vs unprocessed file comparison
- **Comprehensive Date Validation**: Robust parsing with clear error messages

### 🐛 Bug Fixes
- Fixed datetime prefix formatting consistency in transcribe.mjs
- Improved process history tracking for duplicate detection
- Enhanced sequential file processing queue system

### 📝 Documentation
- Updated help text with comprehensive examples and format documentation
- Added date range processing examples to README

---

## [1.7.0] - 2025-07-19 - Automatic Model Version Checking

### ✨ New Features
- **Automatic Claude Model Checking**: Monitors for newer Claude models
  - Checks Anthropic documentation for latest Opus 4 and Sonnet 4 models
  - 24-hour caching to minimize API requests
  - Non-blocking implementation that doesn't slow transcriptions
  - Informative messages when updates are available

### 🔧 Technical Improvements
- Created `modelChecker.mjs` with web scraping capabilities
- Added `.model-cache.json` to gitignore
- Integrated checking into main transcription workflow

### 🧪 Testing
- Manual testing utility: `node modelChecker.mjs [model-id]`
- Comprehensive error handling for network issues

---

## [1.6.0] - 2025-07-01 - Major Refactor with Reliability Improvements

### 🎉 Major Features
- **Automatic File Watching**: New `summarai` command (formerly watchDirectories.mjs) for hands-free processing
  - Monitors Apple Voice Memos and Google Drive directories
  - `--cleanout` mode to process existing files before watching
  - Automatic file movement to processed folders

### 🔐 Security & Configuration
- **Environment Configuration Separation**: 
  - API keys in `~/.env` (secure, not committed)
  - Project settings in `./.env` (committed, non-sensitive)
- **Configurable Timeouts**: `SCRIBE_TIMEOUT_SECONDS` and `CLAUDE_TIMEOUT_SECONDS`

### 🛡️ Reliability & Error Handling
- **Comprehensive Retry Logic**: New `retryUtils.mjs` with exponential backoff
  - Configurable retry attempts and delays via environment variables
  - Custom retry logic for specific API error types
  - Rate limit handling for Claude API (429 errors)
- **API Improvements**: Enhanced error handling in `scribeAPI.mjs` and `claudeAPI.mjs`
  - Handle ElevenLabs "Response body object should not be disturbed" errors
  - Fresh Blob creation on retry attempts for Scribe API

### ⚡ Performance Optimizations
- **Audio Speed Optimization**: 1.5x speed increase (`atempo=1.5`) for all ffmpeg commands
- **Deferred Cleanup**: Support for `fromGoogleDrive` parameter to optimize temp file handling

### 📚 Documentation
- Updated README.md with new features and installation instructions
- Documented two-file environment setup and security considerations

---

## [1.5.0] - 2025-06-15 - Silent Mode & Automation

### ✨ New Features
- **Silent Mode**: `--silent` flag for fully automated processing
  - Automatically processes newest unprocessed voice memo
  - Uses Scribe model 1 with auto speaker detection
  - Perfect for automated workflows and scripts

### 🔧 Code Improvements
- Refactored command line argument parsing for better organization
- Added `getLatestUnprocessedVoiceMemo` and `processInSilentMode` functions
- Removed verbose debug logging from Claude API responses

### 🗂️ File Management
- **Sony IC Recorder Integration**: Added `sync_sony.sh` script
  - Automatic syncing from Sony IC Recorder via USB
  - Keyboard Maestro integration for triggered syncing
  - Duplicate prevention and logging
- Enhanced gitignore with `.move_log` and `move_debug.log`

---

## [1.4.0] - 2025-05-30 - Enhanced API Integration

### 🔧 API Improvements
- **Environment Variable Handling**: Improved API key access patterns
- **Timeout Configuration**: Configurable timeouts for better reliability
- **Default Service Switch**: ElevenLabs Scribe as default transcription service

### 📈 Audio Processing
- **Low Quality Option**: `--low` flag for faster processing with smaller files
- **Video File Support**: Full support for audio extraction from video files
  - MP4, MOV, AVI, MKV, WebM support
  - Automatic audio stream detection and extraction

### 📝 Output Improvements
- **Timestamped Segments**: Enhanced transcription output with timestamp information
- **Rich Markdown Files**: Improved formatting and metadata in output files

---

## [1.3.0] - 2025-04-15 - Workflow & Organization Features

### 🗂️ File Organization
- **Keyword-Based Directories**: Automatic file routing based on configurable keywords
  - Files route to `output/[keyword]/` based on first match
  - Customizable keywords in `keywords.txt`
- **Process History Tracking**: Prevents duplicate processing with `process_history.json`
- **Enhanced Metadata Display**: Duration, date, and GPS information for voice memos

### ⚡ Performance & Quality
- **Audio Optimization**: AAC format compression (48k, mono, 16kHz) for optimal transcription
- **MP3 Compression Workflow**: Streamlined audio processing pipeline
- **Automatic Cleanup**: Improved temporary file management

### 📝 Content Processing
- **Nomenclature Support**: Domain-specific term recognition via `nomenclature.txt`
- **Enhanced Summary Extraction**: Better keyword extraction and content summarization
- **Auto-Transcribe Integration**: Seamless integration between processing components

---

## [1.2.0] - 2025-03-20 - Core Functionality

### 🎯 Initial Feature Set
- **Multiple Transcription Services**: Support for OpenAI Whisper and ElevenLabs Scribe
- **Claude AI Integration**: Advanced summarization and markdown generation
- **File Metadata Extraction**: Duration, date, and GPS data from voice memos
- **Flexible Output Options**: Command line arguments for service selection and file processing
- **Nomenclature System**: Custom terminology support for accurate transcription

### 🛠️ Technical Foundation
- **Modular Architecture**: Separated concerns across multiple specialized modules
- **Error Handling**: Basic error recovery and user feedback
- **File Processing Pipeline**: End-to-end workflow from audio input to markdown output

---

## Release Notes Format

### 🎉 Major Features
New significant capabilities or major architectural changes

### ✨ New Features  
New functionality and enhancements

### 🔧 Technical Improvements
Code quality, performance, and maintainability improvements

### 🛡️ Reliability & Error Handling
Bug fixes, error handling, and stability improvements

### 📚 Documentation
Documentation updates, examples, and guides

### 🐛 Bug Fixes
Specific bug fixes and issue resolutions

### ⚡ Performance
Performance optimizations and efficiency improvements

### 🔐 Security
Security enhancements and configuration improvements

---

**Legend:**
- `[Major.Minor.Patch]` - Semantic versioning
- 🎉 Major Features - Breaking changes or significant new capabilities  
- ✨ New Features - Backward-compatible new functionality
- 🔧 Technical Improvements - Code quality and architecture  
- 🛡️ Reliability - Error handling and stability
- 📚 Documentation - Documentation updates
- 🐛 Bug Fixes - Issue resolutions
- ⚡ Performance - Speed and efficiency  
- 🔐 Security - Security enhancements