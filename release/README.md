# watchDirectories Executable

## Quick Start

This is a standalone executable version of watchDirectories for macOS ARM64 (Apple Silicon).

### First Run on macOS

When running this executable for the first time, macOS will show a security warning:
"watchDirectories cannot be opened because it is from an unidentified developer"

**To run it:**
1. Right-click (or Control-click) on `watchDirectories`
2. Select "Open" from the context menu
3. Click "Open" in the security dialog
4. This only needs to be done once

### Setup

1. **Configure API Keys**
   - Copy `.env.example` to `.env`
   - Add your API keys to the `.env` file

2. **Review Configuration**
   - Edit `config.yaml` to match your directory paths and preferences
   - Key settings to update:
     - `directories.voiceMemos`: Path to Apple Voice Memos
     - `directories.googleDrive.unprocessed`: Path to Google Drive folder
     - `transcription.defaultService`: Choose 'whisper' or 'scribe'

3. **Run the Executable**
   ```bash
   ./watchDirectories
   ```

## Usage

### Basic Commands

```bash
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
```

### Command Options

- `--process-recent-vm [date-range]` - Process unprocessed Voice Memos
  - No date: last 120 days
  - Single date (MM-DD-YY): from that date to now
  - Date range (MM-DD-YY:MM-DD-YY): specific range
- `--cleanout` - Process all existing files in Google Drive unprocessed folder
- `--dry-run` - Preview what would be processed without actually processing
- `--help` - Show detailed help

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
- Copy `.env.example` to `.env`
- Add your actual API keys to `.env`

### "Directory not found" errors
- Update paths in config.yaml to match your system
- Ensure directories exist and have read/write permissions

## Version Info
- Version: 1.0.0
- Build Date: 2025-08-30
- Platform: macOS ARM64 (Apple Silicon)
- Runtime: Bun (embedded)

## Support

For issues or questions, see the main project repository.
