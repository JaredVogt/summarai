# Voice Memos Script

## Location of Voice Memo M4A Files

On macOS, audio files created by the Voice Memos app are stored in:

```
~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings
```

Each voice memo is saved as an `.m4a` audio file in this directory. The filename typically includes the date, time, and a unique identifier.

---

## What `getLatestVoiceMemo.mjs` Does

- Scans the Voice Memos recordings directory for `.m4a` files.
- Finds the most recently modified `.m4a` file (the latest voice memo).
- Prints the filename of the latest `.m4a` file.
- If run with the `-read` or `--read` command line option, plays the latest `.m4a` file using the `afplay` command (macOS native audio player).

### Usage

```sh
node getLatestVoiceMemo.mjs          # Prints the latest .m4a file
node getLatestVoiceMemo.mjs -read    # Prints and plays the latest .m4a file
node getLatestVoiceMemo.mjs --read   # Prints and plays the latest .m4a file
```

**Note:** You must have permissions to access the Voice Memos directory. On macOS, you may need to grant your terminal Full Disk Access in System Settings > Privacy & Security > Full Disk Access.

---

## Requirements
- Node.js (supports ES modules)
- macOS (for `afplay` and the default Voice Memos location)

---

## Limitations
- Only works on macOS.
- Only finds and plays `.m4a` files in the default Voice Memos location.
- You need to have `afplay` available (standard on macOS).
