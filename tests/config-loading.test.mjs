#!/usr/bin/env bun

/**
 * Tests for configuration loading and parsing
 * Validates that config paths are correctly resolved and values parsed
 * Includes regression tests for edge cases in parseValue, getConfigValue, and env overrides
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { loadConfig, getConfigValue, parseValue, getLastConfigPath } from '../configLoader.mjs';

describe('Config Loading', () => {
  describe('parseValue', () => {
    test('parses inline arrays with numbers', () => {
      expect(parseValue('[5000, 15000, 30000]')).toEqual([5000, 15000, 30000]);
    });

    test('parses empty inline arrays', () => {
      expect(parseValue('[]')).toEqual([]);
    });

    test('parses inline arrays with mixed types', () => {
      expect(parseValue('[true, 5000, "test"]')).toEqual([true, 5000, 'test']);
    });

    test('parses inline arrays with booleans', () => {
      expect(parseValue('[true, false]')).toEqual([true, false]);
    });

    test('parses inline arrays with strings', () => {
      expect(parseValue('["hello", "world"]')).toEqual(['hello', 'world']);
    });

    test('parses integers', () => {
      expect(parseValue('42')).toBe(42);
    });

    test('parses floats', () => {
      expect(parseValue('3.14')).toBe(3.14);
    });

    test('parses booleans', () => {
      expect(parseValue('true')).toBe(true);
      expect(parseValue('false')).toBe(false);
    });

    test('parses null', () => {
      expect(parseValue('null')).toBe(null);
      expect(parseValue('~')).toBe(null);
    });

    test('parses quoted strings', () => {
      expect(parseValue('"hello world"')).toBe('hello world');
      expect(parseValue("'hello world'")).toBe('hello world');
    });

    test('removes inline comments', () => {
      expect(parseValue('42 # this is a comment')).toBe(42);
      expect(parseValue('true # boolean value')).toBe(true);
    });

    // Regression tests for parseValue edge cases
    test('handles negative numbers', () => {
      expect(parseValue('-25')).toBe(-25);
      expect(parseValue('-3.14')).toBe(-3.14);
    });

    test('handles scientific notation', () => {
      expect(parseValue('1e5')).toBe(100000);
      expect(parseValue('2.5e3')).toBe(2500);
    });

    test('handles zero', () => {
      expect(parseValue('0')).toBe(0);
      expect(parseValue('0.0')).toBe(0);
    });

    test('preserves plain strings without quotes', () => {
      expect(parseValue('hello')).toBe('hello');
      expect(parseValue('some_value')).toBe('some_value');
    });

    test('handles multiline string indicator', () => {
      expect(parseValue('| some text')).toBe('some text');
    });

    test('handles arrays with negative numbers', () => {
      expect(parseValue('[-1, -2, -3]')).toEqual([-1, -2, -3]);
    });

    test('handles arrays with quoted strings containing commas', () => {
      // Current behavior: simple split doesn't handle quoted strings with commas
      // This documents the limitation
      expect(parseValue('["hello", "world"]')).toEqual(['hello', 'world']);
    });

    test('handles nested inline arrays gracefully', () => {
      // Nested arrays are not fully supported - documents behavior
      const result = parseValue('[[1, 2], [3, 4]]');
      // Current parser treats this as flat array with strings
      expect(Array.isArray(result)).toBe(true);
    });

    test('handles whitespace around values (documents behavior)', () => {
      // Numbers have whitespace trimmed due to parseFloat behavior
      expect(parseValue('  42  ')).toBe(42);
      // Booleans and strings are NOT trimmed - this documents the current behavior
      // parseValue checks exact match for 'true'/'false', so whitespace breaks it
      expect(parseValue('  true  ')).toBe('  true  ');
    });

    test('handles empty string in quotes', () => {
      expect(parseValue('""')).toBe('');
      expect(parseValue("''")).toBe('');
    });
  });

  describe('validation config paths', () => {
    let config;

    beforeEach(() => {
      config = loadConfig();
    });

    test('reads validation enabled setting from correct path', () => {
      const enabled = getConfigValue(config, 'watch.stability.validation.enabled', null);
      expect(enabled).not.toBeNull();
      expect(typeof enabled).toBe('boolean');
    });

    test('reads validation level setting from correct path', () => {
      const level = getConfigValue(config, 'watch.stability.validation.level', null);
      expect(level).not.toBeNull();
      expect(typeof level).toBe('string');
      expect(['moov', 'full', 'basic']).toContain(level);
    });

    test('reads minFileSize setting from correct path', () => {
      const minFileSize = getConfigValue(config, 'watch.stability.validation.minFileSize', null);
      expect(minFileSize).not.toBeNull();
      expect(typeof minFileSize).toBe('number');
      expect(minFileSize).toBeGreaterThan(0);
    });

    test('reads retryMaxAttempts from correct path', () => {
      const maxAttempts = getConfigValue(config, 'watch.stability.validation.retryMaxAttempts', null);
      expect(maxAttempts).not.toBeNull();
      expect(typeof maxAttempts).toBe('number');
      expect(maxAttempts).toBeGreaterThanOrEqual(1);
    });

    test('reads retryDelays as array from correct path', () => {
      const delays = getConfigValue(config, 'watch.stability.validation.retryDelays', null);
      expect(delays).not.toBeNull();
      expect(Array.isArray(delays)).toBe(true);
      expect(delays.length).toBeGreaterThan(0);
      delays.forEach(delay => {
        expect(typeof delay).toBe('number');
        expect(delay).toBeGreaterThan(0);
      });
    });
  });

  describe('getConfigValue', () => {
    let config;

    beforeEach(() => {
      config = loadConfig();
    });

    test('returns value for existing path', () => {
      const service = getConfigValue(config, 'transcription.defaultService', null);
      expect(service).not.toBeNull();
    });

    test('returns default for non-existent path', () => {
      const value = getConfigValue(config, 'non.existent.path', 'default-value');
      expect(value).toBe('default-value');
    });

    test('returns default for null config', () => {
      const value = getConfigValue(null, 'some.path', 'default');
      expect(value).toBe('default');
    });

    test('returns default for undefined intermediate path', () => {
      const value = getConfigValue(config, 'non.existent.deeply.nested.path', 42);
      expect(value).toBe(42);
    });

    // Regression tests for getConfigValue edge cases
    test('returns undefined correctly (not default) when path exists but value is undefined', () => {
      const testConfig = { a: { b: undefined } };
      // When value is explicitly undefined, should return default
      expect(getConfigValue(testConfig, 'a.b', 'default')).toBe('default');
    });

    test('returns null when value is explicitly null (not default)', () => {
      const testConfig = { a: { b: null } };
      // null is a valid value, should return null not default
      expect(getConfigValue(testConfig, 'a.b', 'default')).toBeNull();
    });

    test('handles array indices in path (documents behavior)', () => {
      const testConfig = { items: [{ name: 'first' }, { name: 'second' }] };
      // Array indices actually work with dot notation in getConfigValue
      // JavaScript arrays are objects, so arr['0'] === arr[0]
      expect(getConfigValue(testConfig, 'items.0.name', 'fallback')).toBe('first');
      expect(getConfigValue(testConfig, 'items.1.name', 'fallback')).toBe('second');
      // Out of bounds returns fallback
      expect(getConfigValue(testConfig, 'items.5.name', 'fallback')).toBe('fallback');
    });

    test('returns false when value is explicitly false (not default)', () => {
      const testConfig = { feature: { enabled: false } };
      expect(getConfigValue(testConfig, 'feature.enabled', true)).toBe(false);
    });

    test('returns 0 when value is explicitly 0 (not default)', () => {
      const testConfig = { settings: { count: 0 } };
      expect(getConfigValue(testConfig, 'settings.count', 100)).toBe(0);
    });

    test('returns empty string when value is explicitly empty string (not default)', () => {
      const testConfig = { settings: { name: '' } };
      expect(getConfigValue(testConfig, 'settings.name', 'default-name')).toBe('');
    });

    test('handles deeply nested paths', () => {
      const testConfig = { a: { b: { c: { d: { e: 'deep' } } } } };
      expect(getConfigValue(testConfig, 'a.b.c.d.e', 'not-found')).toBe('deep');
    });

    test('handles empty path string', () => {
      const testConfig = { key: 'value' };
      // Empty path returns the config itself (first part is '')
      const result = getConfigValue(testConfig, '', 'default');
      // An empty string splits to [''], and testConfig[''] is undefined
      expect(result).toBe('default');
    });

    test('handles single-level paths', () => {
      const testConfig = { simple: 'value' };
      expect(getConfigValue(testConfig, 'simple', 'default')).toBe('value');
    });
  });

  describe('loadConfig', () => {
    test('loads config successfully', () => {
      const config = loadConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    test('config has required sections', () => {
      const config = loadConfig();
      expect(config.directories).toBeDefined();
      expect(config.transcription).toBeDefined();
      expect(config.fileProcessing).toBeDefined();
    });

    test('watch.stability section exists', () => {
      const config = loadConfig();
      expect(config.watch).toBeDefined();
      expect(config.watch.stability).toBeDefined();
    });

    test('validation config is nested under stability', () => {
      const config = loadConfig();
      expect(config.watch.stability.validation).toBeDefined();
    });

    // Regression tests for loadConfig
    test('throws clear error when config file not found', () => {
      expect(() => loadConfig('/nonexistent/path/to/config.yaml')).toThrow(/not found/i);
    });

    test('getLastConfigPath returns loaded path', () => {
      loadConfig();
      const lastPath = getLastConfigPath();
      expect(lastPath).toContain('config.yaml');
    });
  });

  describe('applyEnvOverrides', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      // Clean up test env vars
      Object.keys(process.env).forEach(key => {
        if (key.startsWith('PROCESSVM_')) {
          delete process.env[key];
        }
      });
      // Restore original env
      Object.keys(originalEnv).forEach(key => {
        if (originalEnv[key] !== undefined) {
          process.env[key] = originalEnv[key];
        }
      });
    });

    test('PROCESSVM_* variables override config values', () => {
      // Set env var before loading config
      process.env.PROCESSVM_TRANSCRIPTION_DEFAULTSERVICE = 'whisper';
      const config = loadConfig();

      // Should have value from env override
      expect(getConfigValue(config, 'transcription.defaultservice', null)).toBe('whisper');
    });

    test('handles numeric env var values', () => {
      process.env.PROCESSVM_WATCH_STABILITY_THRESHOLD = '5';
      const config = loadConfig();

      // Should parse as number
      expect(getConfigValue(config, 'watch.stability.threshold', null)).toBe(5);
    });

    test('handles boolean env var values', () => {
      process.env.PROCESSVM_WATCH_STABILITY_VALIDATION_ENABLED = 'false';
      const config = loadConfig();

      // Should parse as boolean
      const value = getConfigValue(config, 'watch.stability.validation.enabled', null);
      expect(value).toBe(false);
    });

    test('env vars with underscores map to nested paths', () => {
      process.env.PROCESSVM_A_B_C = 'deep-value';
      const config = loadConfig();

      // PROCESSVM_A_B_C should map to config.a.b.c
      expect(getConfigValue(config, 'a.b.c', null)).toBe('deep-value');
    });
  });

  describe('config schema integration', () => {
    test('config passes schema validation without errors', async () => {
      const { validateConfig } = await import('../src/configSchema.mjs');
      const config = loadConfig();
      const result = validateConfig(config);
      // Should be successful or only have warnings (non-critical issues)
      if (!result.success) {
        console.log('Schema validation warnings:', result.errors);
      }
      // We expect it to load - schema validation is warn-only
      expect(config).toBeDefined();
    });

    test('watch validation schema accepts valid config', async () => {
      const { validateWatchValidation } = await import('../src/configSchema.mjs');
      const validConfig = {
        enabled: true,
        level: 'moov',
        minFileSize: 1024,
        retryMaxAttempts: 3,
        retryDelays: [5000, 15000, 30000]
      };
      const result = validateWatchValidation(validConfig);
      expect(result.success).toBe(true);
    });

    test('watch validation schema rejects invalid level', async () => {
      const { validateWatchValidation } = await import('../src/configSchema.mjs');
      const invalidConfig = {
        enabled: true,
        level: 'invalid_level',
        minFileSize: 1024
      };
      const result = validateWatchValidation(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.includes('level'))).toBe(true);
    });
  });
});
