# Migration Guide - Configuration System Update

This guide helps you migrate from the previous environment variable-based configuration to the new centralized YAML configuration system.

## 🚨 Important Changes

**Version 2.0** introduces a major configuration overhaul that **centralizes all settings** in a single `config.yaml` file instead of scattered environment variables and hardcoded values.

### What Changed
- **Environment variables** (`.env`) → **YAML configuration** (`config.yaml`)
- **Hardcoded paths** → **Configurable directory settings**
- **Fixed audio settings** → **Customizable compression and processing**
- **Static file extensions** → **Configurable supported formats**

### Backward Compatibility
✅ **Automatic fallback** - The system automatically uses environment variables if `config.yaml` cannot be loaded
✅ **No breaking changes** - Existing setups continue to work without modification
✅ **Gradual migration** - You can migrate at your own pace

## 🔄 Quick Migration Steps

### 1. Copy Configuration Template
```bash
cp example.config.yaml config.yaml
```

### 2. Transfer Your Settings
Review your existing `.env` file and transfer settings to the corresponding sections in `config.yaml`:

#### Directory Paths
```yaml
# OLD (.env)
GOOGLE_DRIVE_UNPROCESSED=/path/to/unprocessed
GOOGLE_DRIVE_PROCESSED=/path/to/processed

# NEW (config.yaml)
directories:
  googleDrive:
    unprocessed: /path/to/unprocessed
    processed: /path/to/processed
```

#### API Configuration
```yaml
# OLD (.env)
API_MAX_RETRIES=3
API_RETRY_BASE_DELAY=1000
SCRIBE_TIMEOUT_SECONDS=300
CLAUDE_TIMEOUT_SECONDS=120

# NEW (config.yaml)
api:
  retry:
    maxRetries: 3
    baseDelay: 1000
  timeouts:
    scribe: 300
    claude: 120
```

### 3. Verify Configuration
```bash
node -e "import('./configLoader.mjs').then(({loadConfig}) => {try {console.log('✅ Config loaded successfully');} catch(e) {console.error('❌ Config error:', e.message);}})"
```

### 4. Test Your Setup
```bash
# Test with a single file
node transcribe.mjs --file /path/to/test-audio.m4a

# Test file watching (Ctrl+C to stop after a few seconds)
node watchDirectories.mjs
```

## 📋 Complete Migration Reference

### Environment Variables → Config Sections

| Old Environment Variable | New Config Location |
|---------------------------|-------------------|
| `GOOGLE_DRIVE_UNPROCESSED` | `directories.googleDrive.unprocessed` |
| `GOOGLE_DRIVE_PROCESSED` | `directories.googleDrive.processed` |
| `API_MAX_RETRIES` | `api.retry.maxRetries` |
| `API_RETRY_BASE_DELAY` | `api.retry.baseDelay` |
| `API_RETRY_MAX_DELAY` | `api.retry.maxDelay` |
| `SCRIBE_TIMEOUT_SECONDS` | `api.timeouts.scribe` |
| `CLAUDE_TIMEOUT_SECONDS` | `api.timeouts.claude` |

### New Configuration Options

These settings were previously hardcoded and are now configurable:

#### File Processing
```yaml
fileProcessing:
  supportedExtensions:
    audio: [.m4a, .mp3, .wav, .ogg, .flac]
    video: [.mp4, .mov, .avi, .mkv, .webm]
  ignore:
    patterns: [temp*, chunk_*, "*.processing"]
    directories: [/temp/, /temp]
```

#### Audio Processing
```yaml
audio:
  compression:
    normal:
      bitrate: 48k
      sampleRate: 16000
    low:
      bitrate: 24k
      sampleRate: 8000
  processing:
    speedAdjustment: 1.5  # Previously fixed at 1.5x
    codec: aac
    channels: 1
  chunking:
    maxSizeMB: 22
```

#### Watch Behavior
```yaml
watch:
  enabled:
    voiceMemos: true
    googleDrive: true
  initialProcessing:
    cleanout: false
    processRecentVm: false
    defaultDateRange: 120  # Previously fixed at 120 days
  stability:
    threshold: 2000  # File stability wait time
    pollInterval: 100
  queue:
    delayBetweenFiles: 2000  # Previously fixed at 2000ms
    initialDelay: 5000       # Previously fixed at 5000ms
```

## 🎛️ Environment Variable Override System

The new system supports environment variable overrides using the format:
```bash
PROCESSVM_SECTION_SUBSECTION_KEY=value
```

### Examples
```bash
# Override directories
export PROCESSVM_DIRECTORIES_VOICEMEMOS="/custom/voice/memos/path"
export PROCESSVM_DIRECTORIES_GOOGLEDRIVE_UNPROCESSED="/custom/unprocessed"

# Override transcription settings
export PROCESSVM_TRANSCRIPTION_DEFAULTSERVICE="whisper"
export PROCESSVM_TRANSCRIPTION_SCRIBE_MODEL="scribe_v1_experimental"

# Override audio settings
export PROCESSVM_AUDIO_PROCESSING_SPEEDADJUSTMENT="1.0"
export PROCESSVM_AUDIO_COMPRESSION_NORMAL_BITRATE="64k"
```

## 🔧 Common Migration Scenarios

### Scenario 1: Basic User (Default Settings)
If you were using mostly default settings:

1. Copy the template: `cp example.config.yaml config.yaml`
2. Update only the Google Drive paths in `config.yaml`
3. Done! The rest uses sensible defaults.

### Scenario 2: Custom Directories Only
If you only customized directory paths:

```yaml
directories:
  voiceMemos: ~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings
  googleDrive:
    unprocessed: /your/custom/unprocessed/path
    processed: /your/custom/processed/path
  output: /your/custom/output/path
```

### Scenario 3: Heavy Customization
If you modified many environment variables:

1. Review your current `.env` file
2. Use the reference table above to map each variable
3. Add any custom values to `config.yaml`
4. Test with `node transcribe.mjs --help` to ensure everything loads

### Scenario 4: Keep Using Environment Variables
If you prefer to keep using environment variables:

1. Don't create `config.yaml` - the system will automatically fall back to `.env`
2. Or create a minimal `config.yaml` with only the settings you want centralized
3. Use the new `PROCESSVM_*` format for any new overrides

## ⚡ Benefits After Migration

### For Users
- **Single source of truth** - All settings in one file
- **Better documentation** - Inline comments explain each option
- **Easier customization** - No need to remember environment variable names
- **Validation** - Configuration errors caught early with helpful messages

### For Advanced Users
- **Hierarchical organization** - Logical grouping of related settings
- **Environment flexibility** - Override any setting per deployment
- **Path expansion** - `~` automatically expands to home directory
- **Extensibility** - Easy to add new configuration options

## 🚨 Troubleshooting

### "Configuration file not found"
- Ensure `config.yaml` exists in the project root
- Copy from template: `cp example.config.yaml config.yaml`

### "Invalid YAML syntax" 
- Check indentation (use spaces, not tabs)
- Ensure arrays use proper format:
  ```yaml
  # Correct
  audio:
    - .mp3
    - .wav
  
  # Incorrect
  audio: [.mp3, .wav]  # This inline format is not supported
  ```

### Environment variables not working
- New format: `PROCESSVM_DIRECTORIES_VOICEMEMOS` (not `GOOGLE_DRIVE_UNPROCESSED`)
- Check the reference table above for exact format

### Settings not taking effect
- Test config loading: `node -e "import('./configLoader.mjs').then(({loadConfig}) => console.log(JSON.stringify(loadConfig(), null, 2)))"`
- Verify your changes are in the right section
- Check for YAML syntax errors

## 🔄 Rollback Plan

If you need to rollback to environment variables:

1. **Delete or rename** `config.yaml`:
   ```bash
   mv config.yaml config.yaml.backup
   ```

2. **Keep your existing** `.env` file - it will be used automatically

3. **Restart** your processes - they'll detect the missing config and use environment variables

## 🎉 You're Done!

After migration, you'll have:
- ✅ Centralized configuration in `config.yaml`  
- ✅ All the new customization options available
- ✅ Environment variable override capability
- ✅ Better error messages and validation
- ✅ Easier maintenance and deployment

The migration preserves all your existing functionality while unlocking powerful new customization capabilities!

## 📚 Next Steps

1. **Explore new features** in the updated README.md
2. **Customize audio processing** settings for your workflow
3. **Set up additional file extensions** if needed
4. **Configure watch behavior** for your use case
5. **Consider using environment overrides** for different deployment environments