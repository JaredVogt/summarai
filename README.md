# Voice Memo Processing & Transcription Workflow

## Features

- Lists recent voice memos sorted by date/time in filename (not modification time)
- Displays metadata for each memo: duration (mins:secs), recording date, GPS info
- Always compresses selected .m4a files to temp AAC format (48k, mono, 16kHz) before transcription using ffmpeg
- Cleans up temp files after processing
- Sends compressed audio to Whisper for transcription
- Claude summarization and markdown output
- Consistent output naming: prefix is `YYYYMMDD_HH:MM:SS` from original filename
- Output files are written to `output/` or `output/[keyword]/` depending on keyword match (first match only)
- All three files (.md, .m4a, .txt) are written to the same directory
- Nomenclature and instructions notes are prepended to the Claude prompt
- Keywords and nomenclature are fully customizable

## Output Directory Logic

- If no keywords match, files are written to `output/`
- If a keyword matches, files are written only to `output/[first-matching-keyword]/`
- No duplicate files across directories

## File Types Generated

- `.md`: Claude's markdown summary, includes original file/date info
- `.m4a`: Copy of the original audio file
- `.txt`: Whisper raw transcript

## Usage

1. Run: `node transcribe.mjs`
2. Choose how many recent memos to display
3. Pick a file to transcribe
4. All outputs are placed in the appropriate output directory

## Customization

- Edit `keywords.txt` to change output keyword logic
- Edit `nomenclature.txt` for domain-specific terms
- Edit `instructions.md` for Claude prompt instructions

## Requirements

- Node.js (v18+ recommended)
- ffmpeg installed and available in PATH
- Set `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` as environment variables
