# summarai Executable

## Quick Start

This is a standalone executable version of summarai for macOS ARM64 (Apple Silicon).

### First Run on macOS

When running this executable for the first time, macOS will show a security warning:
"summarai cannot be opened because it is from an unidentified developer"

**To run it:**
1. Right-click (or Control-click) on `summarai`
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

3. **Customize Context Files (Optional)**
   - Edit `instructions.md` to customize Claude's processing instructions
   - Edit `nomenclature.txt` to add domain-specific terms and terminology
   - These files control how transcripts are processed and summarized

4. **Run the Executable**
   ```bash
   ./summarai
   ```

## Usage

### Basic Commands

```bash
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
```

### Command Options

- `--process-recent-vm [date-range]` - Process unprocessed Voice Memos
  - No date: last 120 days
  - Single date (MM-DD-YY): from that date to now
  - Date range (MM-DD-YY:MM-DD-YY): specific range
- `--cleanout` - Process all existing files in Google Drive unprocessed folder
- `--dry-run` - Preview what would be processed without actually processing
- `--help` - Show detailed help

### Speaker Identification Setup (Optional)

To enable automatic speaker naming (replace "Speaker 0/1" with actual names):

```bash
# 1. Create Python virtual environment and install dependencies
cd pyannote
python3 -m venv .venv
source .venv/bin/activate
pip3 install -r requirements.txt

# 2. Add HuggingFace token to ~/.env
# Get token at: https://huggingface.co/settings/tokens
# Accept model terms at: https://huggingface.co/pyannote/embedding
echo "HUGGINGFACE_TOKEN=your_token_here" >> ~/.env

# 3. Enable in config.yaml
# Set speakerIdentification.enabled: true
```

Speaker commands:
```bash
./summarai speaker check              # Verify setup
./summarai speaker enroll "Name" file.wav  # Add speaker
./summarai speaker list               # List enrolled speakers
```

## File Processing

The executable watches two directories:
1. **Apple Voice Memos** - Files are transcribed but never moved
2. **Google Drive Unprocessed** - Files are transcribed and moved to processed folder

Supported formats: .m4a, .mp3, .wav, .mp4, .mov

## Customizing Processing

### Context Files

You can customize how the application processes and summarizes your transcripts by editing these files:

#### `instructions.md`
Controls how Claude processes and summarizes transcripts. You can modify:
- Summary format and length requirements
- Keyword extraction rules  
- Action item identification
- Output formatting preferences

#### `nomenclature.txt`
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
- Copy `.env.example` to `.env`
- Add your actual API keys to `.env`

### "Directory not found" errors
- Update paths in config.yaml to match your system
- Ensure directories exist and have read/write permissions

## Version Info
- Version: 2.3.0
- Build Date: 2025-12-22
- Build Time: 2025-12-22T06:40:00.217Z
- Platform: macOS ARM64 (Apple Silicon)
- Runtime: Bun (embedded)

## Support

For issues or questions, see the main project repository.
