# Voice Memos Script

## Location of Voice Memo M4A Files

On macOS, audio files created by the Voice Memos app are stored in:
```
~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings
```
Each voice memo is saved as an `.m4a` audio file in this directory. The filename typically includes the date, time, and a unique identifier.

## What this Project Does

- Lists and selects recent voice memos for processing.
- Transcribes the selected `.m4a` file using OpenAI Whisper API.
- Sends the transcription to Anthropic Claude for summarization/processing.
- Saves Claude's markdown output and a copy of the `.m4a` file to the `output/` directory, using the summary as the filename.
- All files in the `output/` directory are git-ignored by default.

### Usage

1. **Install dependencies:**
```sh
npm install axios form-data
```
2. **Set API keys:**
```sh
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```
3. **Run the script:**
```sh
node transcribe.mjs
```
- You will be prompted for how many recent memos to display and which to transcribe.
- The output markdown and audio will be saved to `output/<summary>.md` and `output/<summary>.m4a`.

### Output Directory

- All processed results are placed in the `output/` directory.
- Filenames are based on the summary field from Claude's markdown output, sanitized for filesystem safety.
- The `output/` directory is included in `.gitignore` by default.

## Requirements

- Node.js (supports ES modules)
- macOS (for `afplay` and the default Voice Memos location)
- OpenAI and Anthropic API keys

## Limitations

- Only works on macOS.
- Only finds and processes `.m4a` files in the default Voice Memos location.
- You need to have `afplay` available (standard on macOS) if you want to play audio.
- Output filenames are limited to 60 characters and sanitized.
