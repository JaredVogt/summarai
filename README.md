# Voice Memo Processing & Transcription Workflow

## Features

- Lists recent voice memos sorted by date/time in filename (not modification time)
- Displays metadata for each memo: duration (mins:secs), recording date, GPS info
- Always compresses selected files to temp AAC format (48k, mono, 16kHz) before transcription using ffmpeg
- Cleans up temp files after processing
- Supports multiple transcription services: ElevenLabs Scribe (default) or OpenAI Whisper
- Claude summarization and markdown output with thinking mode
- Consistent output naming: prefix is `YYYYMMDD_HH:MM:SS` from original filename
- Output files are written to `output/` or `output/[keyword]/` depending on keyword match (first match only)
- All three files (.md, .m4a, .txt) are written to the same directory
- Nomenclature and instructions notes are prepended to the Claude prompt
- Keywords and nomenclature are fully customizable
- Automatic file watching and processing for Voice Memos and Google Drive
- Retry logic with exponential backoff for API reliability
- Audio speed optimization (1.5x) for faster processing

## Output Directory Logic

- If no keywords match, files are written to `output/`
- If a keyword matches, files are written only to `output/[first-matching-keyword]/`
- No duplicate files across directories

## File Types Generated

- `.md`: Claude's markdown summary, includes original file/date info
- `.m4a`: Copy of the original audio file (compressed)
- `.txt`: Transcription raw output

## Usage

### Interactive Mode
1. Run: `node transcribe.mjs`
2. Choose how many recent memos to display
3. Pick a file to transcribe
4. All outputs are placed in the appropriate output directory

### Command Line Options
- `--file <path>`: Process a specific file
- `--service <whisper|scribe>`: Choose transcription service (default: scribe)
- `--low`: Use low quality compression for faster processing
- `--silent`: Run in silent mode (no prompts, automated processing)

### Automatic File Watching
Run `node watchDirectories.mjs` to automatically process new files from:
- Apple Voice Memos directory
- Google Drive unprocessed folder

Options:
- `--cleanout`: Process all existing files in Google Drive unprocessed folder before watching
- `--help`: Show help message

## Configuration

### Environment Variables
The system uses two `.env` files:

1. **`~/.env`** (in your home directory) - For sensitive API keys:
   ```
   ANTHROPIC_API_KEY=your-anthropic-api-key
   ELEVENLABS_API_KEY=your-elevenlabs-api-key
   OPENAI_API_KEY=your-openai-api-key
   ```

2. **`.env`** (in project directory) - For configuration:
   ```
   # Retry Configuration
   API_MAX_RETRIES=3
   API_RETRY_BASE_DELAY=1000
   API_RETRY_MAX_DELAY=30000
   
   # API Timeouts (in seconds)
   SCRIBE_TIMEOUT_SECONDS=300
   CLAUDE_TIMEOUT_SECONDS=120
   
   # Google Drive Directory Paths
   GOOGLE_DRIVE_UNPROCESSED=/path/to/unprocessed
   GOOGLE_DRIVE_PROCESSED=/path/to/processed
   ```

### Customization Files
- Edit `keywords.txt` to change output keyword logic
- Edit `nomenclature.txt` for domain-specific terms
- Edit `instructions.md` for Claude prompt instructions

## Requirements

- Node.js (v18+ recommended)
- ffmpeg installed and available in PATH
- API keys for the services you want to use (see Environment Variables above)

## Installation

1. Clone the repository
2. Run `npm install` to install dependencies
3. Create `~/.env` file with your API keys
4. Review and adjust `.env` configuration as needed
5. Customize keywords.txt, nomenclature.txt, and instructions.md as desired