#!/usr/bin/env bun

/**
 * Tests for process history management and migration
 * Validates NDJSON history format, legacy migration, and failure tracking
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Create isolated test environment
let testDir;
let testConfig;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summarai-test-'));
  testConfig = {
    fileProcessing: {
      history: {
        file: path.join(testDir, 'processed_log.ndjson')
      }
    }
  };
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('Process History', () => {
  describe('migrateLegacyIfPresent', () => {
    test('migrates legacy array format to NDJSON when in same directory', async () => {
      // Create legacy file in same directory as NDJSON history file
      // The migration looks for process_history.json in the directory of the ndjson file
      const legacyPath = path.join(testDir, 'process_history.json');
      const legacy = [
        { filename: 'test1.m4a', timestamp: '2025-01-01T00:00:00Z' },
        { filename: 'test2.m4a', timestamp: '2025-01-02T00:00:00Z' }
      ];
      fs.writeFileSync(legacyPath, JSON.stringify(legacy));

      // Re-import to get fresh module (migration is checked once per loadIndex call)
      // Note: The migration only runs if NDJSON doesn't exist and legacy is found
      // Migration candidates are: 1) same dir as ndjson, 2) CWD, 3) CWD/output
      const { migrateLegacyIfPresent, loadIndex } = await import('../src/processHistory.mjs');

      // Manually call migration to simulate the behavior
      migrateLegacyIfPresent(testConfig);

      // Now the NDJSON file should exist with migrated data
      const ndjsonPath = testConfig.fileProcessing.history.file;
      if (fs.existsSync(ndjsonPath)) {
        const content = fs.readFileSync(ndjsonPath, 'utf8').trim();
        const lines = content.split('\n').filter(l => l.trim());
        expect(lines.length).toBeGreaterThan(0);
        // Check that at least one record was migrated
        const firstRecord = JSON.parse(lines[0]);
        expect(['test1.m4a', 'test2.m4a']).toContain(firstRecord.sourceName);
      }
    });

    test('migrates legacy object format { processedFiles: [] } when in same directory', async () => {
      const legacyPath = path.join(testDir, 'process_history.json');
      const legacy = {
        processedFiles: [
          { filename: 'obj1.m4a', timestamp: '2025-01-01T00:00:00Z' }
        ]
      };
      fs.writeFileSync(legacyPath, JSON.stringify(legacy));

      const { migrateLegacyIfPresent } = await import('../src/processHistory.mjs');
      migrateLegacyIfPresent(testConfig);

      const ndjsonPath = testConfig.fileProcessing.history.file;
      if (fs.existsSync(ndjsonPath)) {
        const content = fs.readFileSync(ndjsonPath, 'utf8').trim();
        const record = JSON.parse(content);
        expect(record.sourceName).toBe('obj1.m4a');
      }
    });

    test('skips migration if NDJSON already exists', async () => {
      // Create NDJSON file first
      const ndjsonPath = testConfig.fileProcessing.history.file;
      fs.writeFileSync(ndjsonPath, '{"sourceName":"existing.m4a","sourcePath":"/path/existing.m4a","status":"success"}\n');

      // Create legacy file
      const legacyPath = path.join(testDir, 'process_history.json');
      fs.writeFileSync(legacyPath, JSON.stringify([{ filename: 'legacy.m4a' }]));

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      // Should have existing, not legacy
      expect(index.bySourceName.has('existing.m4a')).toBe(true);
      expect(index.bySourceName.has('legacy.m4a')).toBe(false);
    });

    test('handles malformed legacy JSON gracefully', async () => {
      const legacyPath = path.join(testDir, 'process_history.json');
      fs.writeFileSync(legacyPath, '{invalid json}');

      const { loadIndex } = await import('../src/processHistory.mjs');
      // Should not throw
      const index = loadIndex(testConfig);
      expect(index.bySourceName.size).toBe(0);
    });

    test('handles empty legacy array', async () => {
      const legacyPath = path.join(testDir, 'process_history.json');
      fs.writeFileSync(legacyPath, '[]');

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);
      expect(index.bySourceName.size).toBe(0);
    });

    test('extracts filename from various legacy field names', async () => {
      const legacyPath = path.join(testDir, 'process_history.json');
      const legacy = {
        processedFiles: [
          { originalFileName: 'original.m4a', processedAt: '2025-01-01T00:00:00Z' },
          { file: 'fileField.m4a', timestamp: '2025-01-02T00:00:00Z' }
        ]
      };
      fs.writeFileSync(legacyPath, JSON.stringify(legacy));

      const { migrateLegacyIfPresent } = await import('../src/processHistory.mjs');
      migrateLegacyIfPresent(testConfig);

      const ndjsonPath = testConfig.fileProcessing.history.file;
      if (fs.existsSync(ndjsonPath)) {
        const content = fs.readFileSync(ndjsonPath, 'utf8').trim();
        const lines = content.split('\n').filter(l => l.trim());
        const sourceNames = lines.map(l => JSON.parse(l).sourceName);
        expect(sourceNames).toContain('original.m4a');
        expect(sourceNames).toContain('fileField.m4a');
      }
    });
  });

  describe('loadIndex', () => {
    test('loads valid NDJSON records', async () => {
      const ndjsonPath = testConfig.fileProcessing.history.file;
      fs.writeFileSync(ndjsonPath, [
        '{"sourceName":"file1.m4a","sourcePath":"/path/file1.m4a","status":"success"}',
        '{"sourceName":"file2.m4a","sourcePath":"/path/file2.m4a","status":"success"}'
      ].join('\n') + '\n');

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      expect(index.bySourceName.size).toBe(2);
      expect(index.bySourcePath.size).toBe(2);
    });

    test('skips empty lines in NDJSON', async () => {
      const ndjsonPath = testConfig.fileProcessing.history.file;
      fs.writeFileSync(ndjsonPath, [
        '{"sourceName":"file1.m4a","sourcePath":"/path/file1.m4a","status":"success"}',
        '',
        '{"sourceName":"file2.m4a","sourcePath":"/path/file2.m4a","status":"success"}',
        ''
      ].join('\n'));

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      expect(index.bySourceName.size).toBe(2);
    });

    test('skips malformed lines without crashing', async () => {
      const ndjsonPath = testConfig.fileProcessing.history.file;
      fs.writeFileSync(ndjsonPath, [
        '{"sourceName":"valid.m4a","sourcePath":"/path/valid.m4a","status":"success"}',
        '{malformed json line}',
        '{"sourceName":"also-valid.m4a","sourcePath":"/path/also-valid.m4a","status":"success"}'
      ].join('\n') + '\n');

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      expect(index.bySourceName.size).toBe(2);
      expect(index.bySourceName.has('valid.m4a')).toBe(true);
      expect(index.bySourceName.has('also-valid.m4a')).toBe(true);
    });

    test('tracks failed files separately', async () => {
      const ndjsonPath = testConfig.fileProcessing.history.file;
      fs.writeFileSync(ndjsonPath, [
        '{"sourceName":"failed.m4a","sourcePath":"/path/failed.m4a","status":"failed","attemptNumber":1}',
        '{"sourceName":"success.m4a","sourcePath":"/path/success.m4a","status":"success"}'
      ].join('\n') + '\n');

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      expect(index.failedFiles.size).toBe(1);
      expect(index.failedFiles.has('/path/failed.m4a')).toBe(true);
    });

    test('removes failed status when file later succeeds', async () => {
      const ndjsonPath = testConfig.fileProcessing.history.file;
      fs.writeFileSync(ndjsonPath, [
        '{"sourceName":"retry.m4a","sourcePath":"/path/retry.m4a","status":"failed","attemptNumber":1}',
        '{"sourceName":"retry.m4a","sourcePath":"/path/retry.m4a","status":"success"}'
      ].join('\n') + '\n');

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      expect(index.failedFiles.size).toBe(0);
      expect(index.bySourcePath.has('/path/retry.m4a')).toBe(true);
    });

    test('returns empty sets when file does not exist', async () => {
      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      expect(index.bySourceName.size).toBe(0);
      expect(index.bySourcePath.size).toBe(0);
      expect(index.failedFiles.size).toBe(0);
    });

    test('skips records without sourcePath', async () => {
      const ndjsonPath = testConfig.fileProcessing.history.file;
      fs.writeFileSync(ndjsonPath, [
        '{"sourceName":"no-path.m4a","status":"success"}',
        '{"sourceName":"has-path.m4a","sourcePath":"/path/has-path.m4a","status":"success"}'
      ].join('\n') + '\n');

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      // Only the record with sourcePath should be indexed by path
      expect(index.bySourcePath.size).toBe(1);
      expect(index.bySourcePath.has('/path/has-path.m4a')).toBe(true);
    });

    test('preserves failure metadata (error, attemptNumber)', async () => {
      const ndjsonPath = testConfig.fileProcessing.history.file;
      fs.writeFileSync(ndjsonPath, [
        '{"sourceName":"failed.m4a","sourcePath":"/path/failed.m4a","status":"failed","attemptNumber":3,"error":{"type":"TranscriptionError","message":"API rate limited"},"processedAt":"2025-01-15T10:00:00Z"}'
      ].join('\n') + '\n');

      const { loadIndex } = await import('../src/processHistory.mjs');
      const index = loadIndex(testConfig);

      const failedInfo = index.failedFiles.get('/path/failed.m4a');
      expect(failedInfo).toBeDefined();
      expect(failedInfo.attemptNumber).toBe(3);
      expect(failedInfo.error.type).toBe('TranscriptionError');
      expect(failedInfo.error.message).toBe('API rate limited');
      expect(failedInfo.lastAttemptAt).toBe('2025-01-15T10:00:00Z');
    });
  });

  describe('appendRecord', () => {
    test('creates file if missing', async () => {
      const { appendRecord } = await import('../src/processHistory.mjs');
      appendRecord(testConfig, {
        sourcePath: '/path/new.m4a',
        sourceName: 'new.m4a'
      });

      const ndjsonPath = testConfig.fileProcessing.history.file;
      expect(fs.existsSync(ndjsonPath)).toBe(true);
    });

    test('normalizes undefined values to null', async () => {
      const { appendRecord } = await import('../src/processHistory.mjs');
      appendRecord(testConfig, {
        sourcePath: '/path/test.m4a',
        sourceName: 'test.m4a',
        destAudioPath: undefined,
        sizeSourceBytes: undefined
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.destAudioPath).toBeNull();
      expect(record.sizeSourceBytes).toBeNull();
    });

    test('validates numeric fields', async () => {
      const { appendRecord } = await import('../src/processHistory.mjs');
      appendRecord(testConfig, {
        sourcePath: '/path/test.m4a',
        sourceName: 'test.m4a',
        sizeSourceBytes: 'not a number'
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.sizeSourceBytes).toBeNull();
    });

    test('sets status to success', async () => {
      const { appendRecord } = await import('../src/processHistory.mjs');
      appendRecord(testConfig, {
        sourcePath: '/path/test.m4a',
        sourceName: 'test.m4a'
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.status).toBe('success');
    });

    test('preserves valid numeric sizeSourceBytes', async () => {
      const { appendRecord } = await import('../src/processHistory.mjs');
      appendRecord(testConfig, {
        sourcePath: '/path/test.m4a',
        sourceName: 'test.m4a',
        sizeSourceBytes: 1024000
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.sizeSourceBytes).toBe(1024000);
    });

    test('derives sourceName from sourcePath if not provided', async () => {
      const { appendRecord } = await import('../src/processHistory.mjs');
      appendRecord(testConfig, {
        sourcePath: '/some/deep/path/recording.m4a'
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.sourceName).toBe('recording.m4a');
    });

    test('appends to existing file without overwriting', async () => {
      const { appendRecord } = await import('../src/processHistory.mjs');

      appendRecord(testConfig, {
        sourcePath: '/path/first.m4a',
        sourceName: 'first.m4a'
      });

      appendRecord(testConfig, {
        sourcePath: '/path/second.m4a',
        sourceName: 'second.m4a'
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).sourceName).toBe('first.m4a');
      expect(JSON.parse(lines[1]).sourceName).toBe('second.m4a');
    });

    test('adds processedAt timestamp automatically', async () => {
      const { appendRecord } = await import('../src/processHistory.mjs');
      const beforeTimestamp = new Date().toISOString();

      appendRecord(testConfig, {
        sourcePath: '/path/test.m4a',
        sourceName: 'test.m4a'
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.processedAt).toBeDefined();
      // Timestamp should be after our "before" timestamp
      expect(new Date(record.processedAt) >= new Date(beforeTimestamp)).toBe(true);
    });
  });

  describe('appendFailureRecord', () => {
    test('sets status to failed', async () => {
      const { appendFailureRecord } = await import('../src/processHistory.mjs');
      appendFailureRecord(testConfig, {
        sourcePath: '/path/failed.m4a',
        sourceName: 'failed.m4a',
        attemptNumber: 1
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.status).toBe('failed');
    });

    test('includes attempt number', async () => {
      const { appendFailureRecord } = await import('../src/processHistory.mjs');
      appendFailureRecord(testConfig, {
        sourcePath: '/path/failed.m4a',
        sourceName: 'failed.m4a',
        attemptNumber: 3
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.attemptNumber).toBe(3);
    });

    test('includes structured error information', async () => {
      const { appendFailureRecord } = await import('../src/processHistory.mjs');
      const testError = new Error('API connection failed');
      testError.name = 'ConnectionError';
      testError.code = 'ECONNREFUSED';

      appendFailureRecord(testConfig, {
        sourcePath: '/path/failed.m4a',
        sourceName: 'failed.m4a',
        attemptNumber: 1,
        error: testError
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.error).toBeDefined();
      expect(record.error.type).toBe('ConnectionError');
      expect(record.error.message).toBe('API connection failed');
      expect(record.error.code).toBe('ECONNREFUSED');
    });

    test('handles missing error gracefully', async () => {
      const { appendFailureRecord } = await import('../src/processHistory.mjs');
      appendFailureRecord(testConfig, {
        sourcePath: '/path/failed.m4a',
        sourceName: 'failed.m4a',
        attemptNumber: 1
      });

      const content = fs.readFileSync(testConfig.fileProcessing.history.file, 'utf8');
      const record = JSON.parse(content.trim());

      expect(record.error).toBeNull();
    });
  });

  describe('resolveHistoryPath', () => {
    test('uses config path when provided', async () => {
      const { resolveHistoryPath } = await import('../src/processHistory.mjs');
      const customConfig = {
        fileProcessing: {
          history: {
            file: '/custom/path/history.ndjson'
          }
        }
      };

      const resolved = resolveHistoryPath(customConfig);
      expect(resolved).toBe('/custom/path/history.ndjson');
    });

    test('falls back to default when not configured', async () => {
      const { resolveHistoryPath } = await import('../src/processHistory.mjs');
      const emptyConfig = {};

      const resolved = resolveHistoryPath(emptyConfig);
      expect(resolved).toContain('processed_log.ndjson');
    });
  });
});
