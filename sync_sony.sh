#!/bin/bash

# sync_sony.sh - Sync audio files from Sony IC Recorder to local directory
#
# Purpose: Automatically copies new audio files from a Sony IC Recorder
#          when it's connected via USB. Designed to be triggered by
#          Keyboard Maestro on USB device attachment.
#
# Features:
# - Waits for device to mount (KM triggers before mount completes)
# - Only copies files that don't already exist in destination
# - Keeps a log of copied files for reference
# - Simple output suitable for KM notifications
#
# Usage: ./sync_sony.sh
#        (Usually triggered automatically by Keyboard Maestro)

SOURCE_DIR="/Volumes/IC RECORDER/REC_FILE/FOLDER01"
DEST_DIR="/Users/jaredvogt/projects/processVMs/input_files"
LOG_FILE="/Users/jaredvogt/projects/processVMs/.move_log"

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Wait for device to mount (KM triggers before mount completes)
for i in {1..10}; do
    if [ -d "$SOURCE_DIR" ]; then
        break
    fi
    sleep 1
done

# Check if IC RECORDER is mounted
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: IC RECORDER not found"
    exit 1
fi

# Create log file if it doesn't exist
touch "$LOG_FILE"

# Copy new files
file_count=0
copied_files=""

# Find all files in source directory
for file in "$SOURCE_DIR"/*; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        
        # Check if file already exists in destination
        if [ ! -f "$DEST_DIR/$filename" ]; then
            cp "$file" "$DEST_DIR/"
            echo "$filename" >> "$LOG_FILE"
            ((file_count++))
            copied_files="$copied_files$filename\n"
        fi
    fi
done

# Report results
if [ $file_count -eq 0 ]; then
    echo "No new files to copy"
else
    echo "Copied $file_count file(s):"
    echo -e "$copied_files" | sed '/^$/d'
fi