#!/usr/bin/env node
/**
 * Repair tool for NDJSON history file
 * Backfills sourcePath for existing records by searching watch directories
 *
 * Usage:
 *   node scripts/repair-history.mjs [--dry-run] [--backup]
 *
 * Options:
 *   --dry-run  Show what would be changed without modifying the file
 *   --backup   Create a backup of the original file before making changes
 */

import fs from 'fs';
import path from 'path';
import { loadConfig, getConfigValue } from '../configLoader.mjs';
import { resolveHistoryPath, findFileInWatchDirs } from '../src/processHistory.mjs';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const backup = args.includes('--backup');

// Simple logging
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
};

async function main() {
  log.info('Starting history repair tool...');

  if (dryRun) {
    log.info('Dry run mode - no changes will be made');
  }

  // Load config
  let config;
  try {
    config = loadConfig();
    log.success('Configuration loaded');
  } catch (error) {
    log.error(`Failed to load configuration: ${error.message}`);
    process.exit(1);
  }

  // Resolve history file path
  const historyPath = resolveHistoryPath(config);
  log.info(`History file: ${historyPath}`);

  // Check if history file exists
  if (!fs.existsSync(historyPath)) {
    log.warn('History file does not exist. Nothing to repair.');
    process.exit(0);
  }

  // Read the current history file
  let data;
  try {
    data = fs.readFileSync(historyPath, 'utf8');
  } catch (error) {
    log.error(`Failed to read history file: ${error.message}`);
    process.exit(1);
  }

  const lines = data.split(/\r?\n/);
  const updatedLines = [];
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  log.info(`Processing ${lines.length} lines...`);

  for (const line of lines) {
    // Preserve empty lines
    if (!line.trim()) {
      updatedLines.push(line);
      continue;
    }

    try {
      const record = JSON.parse(line);

      // Skip records that already have sourcePath
      if (record.sourcePath) {
        updatedLines.push(line);
        skippedCount++;
        continue;
      }

      // Try to find the file if we have sourceName
      if (record.sourceName) {
        const foundPath = findFileInWatchDirs(record.sourceName, config);

        if (foundPath) {
          record.sourcePath = foundPath;
          updatedLines.push(JSON.stringify(record));
          updatedCount++;
          log.info(`Found: ${record.sourceName} -> ${foundPath}`);
        } else {
          // Keep original record if file not found
          updatedLines.push(line);
          skippedCount++;
          log.warn(`Not found: ${record.sourceName}`);
        }
      } else {
        // No sourceName to search for
        updatedLines.push(line);
        skippedCount++;
      }
    } catch (error) {
      // Keep malformed lines as-is
      updatedLines.push(line);
      errorCount++;
      log.warn(`Malformed line (keeping as-is): ${line.substring(0, 50)}...`);
    }
  }

  // Summary
  log.info('');
  log.info('--- Summary ---');
  log.info(`Records updated with sourcePath: ${updatedCount}`);
  log.info(`Records skipped (already have sourcePath or not found): ${skippedCount}`);
  log.info(`Malformed lines preserved: ${errorCount}`);

  if (updatedCount === 0) {
    log.info('No changes needed.');
    process.exit(0);
  }

  if (dryRun) {
    log.info('');
    log.info('Dry run complete. Use without --dry-run to apply changes.');
    process.exit(0);
  }

  // Create backup if requested
  if (backup) {
    const backupPath = `${historyPath}.backup.${Date.now()}`;
    try {
      fs.copyFileSync(historyPath, backupPath);
      log.success(`Backup created: ${backupPath}`);
    } catch (error) {
      log.error(`Failed to create backup: ${error.message}`);
      process.exit(1);
    }
  }

  // Write updated file
  try {
    fs.writeFileSync(historyPath, updatedLines.join('\n'));
    log.success(`History file updated successfully`);
  } catch (error) {
    log.error(`Failed to write history file: ${error.message}`);
    process.exit(1);
  }

  log.info('Repair complete!');
}

main().catch((error) => {
  log.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
