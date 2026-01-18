#!/usr/bin/env bun

/**
 * Tests for environment bootstrap and API key validation
 * Validates edge cases in API key validation and file path validation
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

describe('Env Bootstrap', () => {
  describe('validateApiKeys edge cases', () => {
    let originalEnv;

    beforeEach(() => {
      // Save original environment
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    test('rejects missing ANTHROPIC_API_KEY', async () => {
      const { validateApiKeys, ValidationError } = await import('../src/validation.mjs');

      delete process.env.ANTHROPIC_API_KEY;
      process.env.ELEVENLABS_API_KEY = 'valid-elevenlabs-key-12345678';

      expect(() => validateApiKeys()).toThrow(ValidationError);
    });

    test('rejects missing ELEVENLABS_API_KEY', async () => {
      const { validateApiKeys, ValidationError } = await import('../src/validation.mjs');

      process.env.ANTHROPIC_API_KEY = 'valid-anthropic-key-12345678';
      delete process.env.ELEVENLABS_API_KEY;

      expect(() => validateApiKeys()).toThrow(ValidationError);
    });

    test('rejects both keys missing', async () => {
      const { validateApiKeys, ValidationError } = await import('../src/validation.mjs');

      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ELEVENLABS_API_KEY;

      expect(() => validateApiKeys()).toThrow(ValidationError);
    });

    test('accepts keys passed as argument over env vars', async () => {
      const { validateApiKeys } = await import('../src/validation.mjs');

      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ELEVENLABS_API_KEY;

      expect(() => validateApiKeys({
        ANTHROPIC_API_KEY: 'passed-as-argument-key-12345',
        ELEVENLABS_API_KEY: 'passed-as-argument-key-12345'
      })).not.toThrow();
    });

    test('error message lists all missing keys', async () => {
      const { validateApiKeys } = await import('../src/validation.mjs');

      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ELEVENLABS_API_KEY;

      try {
        validateApiKeys();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain('ANTHROPIC_API_KEY');
        expect(error.message).toContain('ELEVENLABS_API_KEY');
      }
    });

    test('error message identifies short keys correctly', async () => {
      const { validateApiKeys } = await import('../src/validation.mjs');

      process.env.ANTHROPIC_API_KEY = 'short';
      process.env.ELEVENLABS_API_KEY = 'also-short';

      try {
        validateApiKeys();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain('too short');
      }
    });

    test('accepts valid keys from environment', async () => {
      const { validateApiKeys } = await import('../src/validation.mjs');

      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-valid-key-here-1234567890';
      process.env.ELEVENLABS_API_KEY = 'valid-elevenlabs-key-12345678901234';

      expect(() => validateApiKeys()).not.toThrow();
    });

    test('minimum length requirement is 20 characters', async () => {
      const { validateApiKeys } = await import('../src/validation.mjs');

      // Exactly 20 characters - should pass
      process.env.ANTHROPIC_API_KEY = '12345678901234567890';
      process.env.ELEVENLABS_API_KEY = '12345678901234567890';

      expect(() => validateApiKeys()).not.toThrow();

      // 19 characters - should fail
      process.env.ANTHROPIC_API_KEY = '1234567890123456789';
      process.env.ELEVENLABS_API_KEY = '1234567890123456789';

      expect(() => validateApiKeys()).toThrow();
    });

    test('ValidationError includes field property', async () => {
      const { validateApiKeys, ValidationError } = await import('../src/validation.mjs');

      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ELEVENLABS_API_KEY;

      try {
        validateApiKeys();
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.field).toBe('apiKeys');
      }
    });

    // Document potential gap: whitespace-only keys pass length check
    test('documents behavior: whitespace passes length check (potential improvement)', async () => {
      const { validateApiKeys } = await import('../src/validation.mjs');

      // 25 spaces passes current length check - documenting this behavior
      process.env.ANTHROPIC_API_KEY = '                         ';
      process.env.ELEVENLABS_API_KEY = '                         ';

      // Current behavior: this passes (documents a gap for future improvement)
      // Note: In a production fix, we'd want to trim and reject whitespace-only keys
      expect(() => validateApiKeys()).not.toThrow();
    });
  });

  describe('file path validation', () => {
    test('blocks absolute paths to /etc/', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateFilePath('/etc/passwd')).toThrow(ValidationError);
    });

    test('blocks absolute paths to /usr/', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateFilePath('/usr/bin/bash')).toThrow(ValidationError);
    });

    test('allows valid relative paths', async () => {
      const { validateFilePath } = await import('../src/validation.mjs');

      expect(() => validateFilePath('./valid-file.txt')).not.toThrow();
      expect(() => validateFilePath('subdir/file.txt')).not.toThrow();
    });

    test('rejects null bytes in paths', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateFilePath('file\x00name.txt')).toThrow(ValidationError);
      expect(() => validateFilePath('path/to\x00/file')).toThrow(ValidationError);
    });

    test('rejects empty string paths', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateFilePath('')).toThrow(ValidationError);
    });

    test('rejects null paths', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateFilePath(null)).toThrow(ValidationError);
    });

    test('rejects undefined paths', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateFilePath(undefined)).toThrow(ValidationError);
    });

    test('blocks path traversal attacks', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateFilePath('../../../etc/passwd')).toThrow(ValidationError);
      expect(() => validateFilePath('foo/../../../etc/passwd')).toThrow(ValidationError);
    });

    test('error message indicates path traversal or system directory', async () => {
      const { validateFilePath } = await import('../src/validation.mjs');

      try {
        validateFilePath('/etc/passwd');
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain('path traversal');
      }
    });

    test('error message indicates null byte', async () => {
      const { validateFilePath } = await import('../src/validation.mjs');

      try {
        validateFilePath('file\x00name.txt');
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain('null byte');
      }
    });

    test('normalizes paths before validation', async () => {
      const { validateFilePath } = await import('../src/validation.mjs');

      // Simple path with dots should be normalized
      const result = validateFilePath('./test/./file.txt');
      expect(result).not.toContain('/./');
    });
  });

  describe('ValidationError class', () => {
    test('has correct name property', async () => {
      const { ValidationError } = await import('../src/validation.mjs');
      const error = new ValidationError('Test message', 'testField');

      expect(error.name).toBe('ValidationError');
    });

    test('stores field property', async () => {
      const { ValidationError } = await import('../src/validation.mjs');
      const error = new ValidationError('Test message', 'testField');

      expect(error.field).toBe('testField');
    });

    test('includes timestamp', async () => {
      const { ValidationError } = await import('../src/validation.mjs');
      const error = new ValidationError('Test message', 'testField');

      expect(error.timestamp).toBeDefined();
      expect(typeof error.timestamp).toBe('string');
      // Should be valid ISO timestamp
      expect(() => new Date(error.timestamp)).not.toThrow();
    });

    test('extends Error class', async () => {
      const { ValidationError } = await import('../src/validation.mjs');
      const error = new ValidationError('Test message', 'testField');

      expect(error).toBeInstanceOf(Error);
    });

    test('has correct message', async () => {
      const { ValidationError } = await import('../src/validation.mjs');
      const error = new ValidationError('Custom error message', 'testField');

      expect(error.message).toBe('Custom error message');
    });
  });

  describe('sanitizeFilename', () => {
    test('removes dangerous characters', async () => {
      const { sanitizeFilename } = await import('../src/validation.mjs');

      const result = sanitizeFilename('file<>:"/\\|?*name.txt');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain(':');
      expect(result).not.toContain('"');
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
      expect(result).not.toContain('|');
      expect(result).not.toContain('?');
      expect(result).not.toContain('*');
    });

    test('removes control characters', async () => {
      const { sanitizeFilename } = await import('../src/validation.mjs');

      const result = sanitizeFilename('file\x00\x01\x1fname.txt');
      expect(result).toBe('filename.txt');
    });

    test('removes leading dots', async () => {
      const { sanitizeFilename } = await import('../src/validation.mjs');

      const result = sanitizeFilename('...hidden.txt');
      expect(result).toBe('hidden.txt');
    });

    test('removes trailing dots', async () => {
      const { sanitizeFilename } = await import('../src/validation.mjs');

      const result = sanitizeFilename('file.txt...');
      expect(result).toBe('file.txt');
    });

    test('replaces spaces with underscores', async () => {
      const { sanitizeFilename } = await import('../src/validation.mjs');

      const result = sanitizeFilename('my file name.txt');
      expect(result).toBe('my_file_name.txt');
    });

    test('limits length to 255 characters', async () => {
      const { sanitizeFilename } = await import('../src/validation.mjs');

      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });

    test('throws on empty input', async () => {
      const { sanitizeFilename, ValidationError } = await import('../src/validation.mjs');

      expect(() => sanitizeFilename('')).toThrow(ValidationError);
    });

    test('throws on null input', async () => {
      const { sanitizeFilename, ValidationError } = await import('../src/validation.mjs');

      expect(() => sanitizeFilename(null)).toThrow(ValidationError);
    });

    test('throws on non-string input', async () => {
      const { sanitizeFilename, ValidationError } = await import('../src/validation.mjs');

      expect(() => sanitizeFilename(123)).toThrow(ValidationError);
      expect(() => sanitizeFilename({})).toThrow(ValidationError);
    });
  });

  describe('validateAudioOptions', () => {
    test('validates correct bitrate format', async () => {
      const { validateAudioOptions } = await import('../src/validation.mjs');

      const result = validateAudioOptions({ bitrate: '48k' });
      expect(result.bitrate).toBe('48k');
    });

    test('rejects invalid bitrate format', async () => {
      const { validateAudioOptions, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateAudioOptions({ bitrate: '48' })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ bitrate: 'high' })).toThrow(ValidationError);
    });

    test('rejects bitrate out of range', async () => {
      const { validateAudioOptions, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateAudioOptions({ bitrate: '4k' })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ bitrate: '500k' })).toThrow(ValidationError);
    });

    test('validates sample rate range', async () => {
      const { validateAudioOptions, ValidationError } = await import('../src/validation.mjs');

      expect(validateAudioOptions({ sampleRate: 16000 }).sampleRate).toBe(16000);
      expect(() => validateAudioOptions({ sampleRate: 1000 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ sampleRate: 100000 })).toThrow(ValidationError);
    });

    test('validates channel count', async () => {
      const { validateAudioOptions, ValidationError } = await import('../src/validation.mjs');

      expect(validateAudioOptions({ channels: 1 }).channels).toBe(1);
      expect(validateAudioOptions({ channels: 2 }).channels).toBe(2);
      expect(() => validateAudioOptions({ channels: 0 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ channels: 5 })).toThrow(ValidationError);
    });

    test('validates codec selection', async () => {
      const { validateAudioOptions, ValidationError } = await import('../src/validation.mjs');

      expect(validateAudioOptions({ codec: 'aac' }).codec).toBe('aac');
      expect(validateAudioOptions({ codec: 'mp3' }).codec).toBe('mp3');
      expect(validateAudioOptions({ codec: 'opus' }).codec).toBe('opus');
      expect(validateAudioOptions({ codec: 'flac' }).codec).toBe('flac');
      expect(() => validateAudioOptions({ codec: 'wav' })).toThrow(ValidationError);
    });

    test('returns empty object for empty input', async () => {
      const { validateAudioOptions } = await import('../src/validation.mjs');

      const result = validateAudioOptions({});
      expect(Object.keys(result).length).toBe(0);
    });
  });

  describe('validateTranscriptionOptions', () => {
    test('validates transcription service', async () => {
      const { validateTranscriptionOptions, ValidationError } = await import('../src/validation.mjs');

      expect(validateTranscriptionOptions({ transcriptionService: 'whisper' }).transcriptionService).toBe('whisper');
      expect(validateTranscriptionOptions({ transcriptionService: 'scribe' }).transcriptionService).toBe('scribe');
      expect(() => validateTranscriptionOptions({ transcriptionService: 'invalid' })).toThrow(ValidationError);
    });

    test('validates model string', async () => {
      const { validateTranscriptionOptions, ValidationError } = await import('../src/validation.mjs');

      expect(validateTranscriptionOptions({ model: 'gpt-4' }).model).toBe('gpt-4');
      expect(() => validateTranscriptionOptions({ model: 'ab' })).toThrow(ValidationError); // too short
    });

    test('validates maxSpeakers range', async () => {
      const { validateTranscriptionOptions, ValidationError } = await import('../src/validation.mjs');

      expect(validateTranscriptionOptions({ maxSpeakers: 2 }).maxSpeakers).toBe(2);
      expect(validateTranscriptionOptions({ maxSpeakers: 32 }).maxSpeakers).toBe(32);
      expect(() => validateTranscriptionOptions({ maxSpeakers: 0 })).toThrow(ValidationError);
      expect(() => validateTranscriptionOptions({ maxSpeakers: 50 })).toThrow(ValidationError);
    });

    test('allows null maxSpeakers', async () => {
      const { validateTranscriptionOptions } = await import('../src/validation.mjs');

      const result = validateTranscriptionOptions({ maxSpeakers: null });
      expect(result.maxSpeakers).toBeUndefined();
    });
  });

  describe('validateProfileName', () => {
    test('accepts valid profile names', async () => {
      const { validateProfileName } = await import('../src/validation.mjs');

      expect(validateProfileName('John Doe')).toBe('John Doe');
      expect(validateProfileName("O'Brien")).toBe("O'Brien");
      expect(validateProfileName('user-name_123')).toBe('user-name_123');
    });

    test('trims whitespace', async () => {
      const { validateProfileName } = await import('../src/validation.mjs');

      expect(validateProfileName('  John Doe  ')).toBe('John Doe');
    });

    test('normalizes internal whitespace', async () => {
      const { validateProfileName } = await import('../src/validation.mjs');

      expect(validateProfileName('John    Doe')).toBe('John Doe');
    });

    test('rejects too short names', async () => {
      const { validateProfileName, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateProfileName('J')).toThrow(ValidationError);
    });

    test('rejects too long names', async () => {
      const { validateProfileName, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateProfileName('a'.repeat(51))).toThrow(ValidationError);
    });

    test('rejects invalid characters', async () => {
      const { validateProfileName, ValidationError } = await import('../src/validation.mjs');

      expect(() => validateProfileName('John@Doe')).toThrow(ValidationError);
      expect(() => validateProfileName('John<script>')).toThrow(ValidationError);
    });
  });
});
