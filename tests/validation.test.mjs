import { test, expect, describe } from 'bun:test';
import { 
  validateFilePath, 
  validateAudioOptions, 
  validateTranscriptionOptions,
  validateApiKeys,
  validateCommandLineArgs,
  sanitizeFilename,
  validateFileSize,
  ValidationError 
} from '../src/validation.mjs';
import fs from 'fs';
import path from 'path';

describe('Validation Functions', () => {
  describe('validateFilePath', () => {
    test('should accept valid file paths', () => {
      const validPath = './test-file.txt';
      const result = validateFilePath(validPath);
      expect(result).toBe(path.normalize(validPath));
    });

    test('should reject path traversal attempts', () => {
      expect(() => validateFilePath('../../../etc/passwd')).toThrow(ValidationError);
      expect(() => validateFilePath('../../secret.txt')).toThrow(ValidationError);
    });

    test('should reject null bytes', () => {
      expect(() => validateFilePath('test\0file.txt')).toThrow(ValidationError);
    });

    test('should reject empty or non-string paths', () => {
      expect(() => validateFilePath('')).toThrow(ValidationError);
      expect(() => validateFilePath(null)).toThrow(ValidationError);
      expect(() => validateFilePath(123)).toThrow(ValidationError);
    });

    test('should reject system directory access', () => {
      expect(() => validateFilePath('/etc/passwd')).toThrow(ValidationError);
      expect(() => validateFilePath('/usr/bin/bash')).toThrow(ValidationError);
    });
  });

  describe('validateAudioOptions', () => {
    test('should accept valid audio options', () => {
      const options = {
        bitrate: '48k',
        sampleRate: 16000,
        channels: 1,
        speedAdjustment: 1.5,
        codec: 'aac'
      };
      const result = validateAudioOptions(options);
      expect(result.bitrate).toBe('48k');
      expect(result.sampleRate).toBe(16000);
      expect(result.channels).toBe(1);
      expect(result.speedAdjustment).toBe(1.5);
      expect(result.codec).toBe('aac');
    });

    test('should reject invalid bitrate formats', () => {
      expect(() => validateAudioOptions({ bitrate: '48' })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ bitrate: 'invalid' })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ bitrate: '500k' })).toThrow(ValidationError);
    });

    test('should reject invalid sample rates', () => {
      expect(() => validateAudioOptions({ sampleRate: 1000 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ sampleRate: 100000 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ sampleRate: 'invalid' })).toThrow(ValidationError);
    });

    test('should reject invalid channels', () => {
      expect(() => validateAudioOptions({ channels: 0 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ channels: 3 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ channels: 'stereo' })).toThrow(ValidationError);
    });

    test('should reject invalid speed adjustments', () => {
      expect(() => validateAudioOptions({ speedAdjustment: 0.1 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ speedAdjustment: 5.0 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ speedAdjustment: 'fast' })).toThrow(ValidationError);
    });

    test('should reject invalid codecs', () => {
      expect(() => validateAudioOptions({ codec: 'invalid' })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ codec: 'wav' })).toThrow(ValidationError);
    });
  });

  describe('validateTranscriptionOptions', () => {
    test('should accept valid transcription options', () => {
      const options = {
        transcriptionService: 'whisper',
        model: 'whisper-1',
        maxSpeakers: 5
      };
      const result = validateTranscriptionOptions(options);
      expect(result.transcriptionService).toBe('whisper');
      expect(result.model).toBe('whisper-1');
      expect(result.maxSpeakers).toBe(5);
    });

    test('should reject invalid transcription services', () => {
      expect(() => validateTranscriptionOptions({ transcriptionService: 'invalid' })).toThrow(ValidationError);
      expect(() => validateTranscriptionOptions({ transcriptionService: 'google' })).toThrow(ValidationError);
    });

    test('should reject invalid models', () => {
      expect(() => validateTranscriptionOptions({ model: '' })).toThrow(ValidationError);
      expect(() => validateTranscriptionOptions({ model: 'ab' })).toThrow(ValidationError);
      expect(() => validateTranscriptionOptions({ model: 123 })).toThrow(ValidationError);
    });

    test('should reject invalid maxSpeakers', () => {
      expect(() => validateTranscriptionOptions({ maxSpeakers: 0 })).toThrow(ValidationError);
      expect(() => validateTranscriptionOptions({ maxSpeakers: 50 })).toThrow(ValidationError);
      expect(() => validateTranscriptionOptions({ maxSpeakers: 'many' })).toThrow(ValidationError);
    });
  });

  describe('validateApiKeys', () => {
    test('should accept valid API keys', () => {
      const keys = {
        ANTHROPIC_API_KEY: 'sk-ant-12345678901234567890',
        ELEVENLABS_API_KEY: 'el-12345678901234567890'
      };
      expect(() => validateApiKeys(keys)).not.toThrow();
    });

    test('should reject missing API keys', () => {
      expect(() => validateApiKeys({})).toThrow(ValidationError);
      expect(() => validateApiKeys({ ANTHROPIC_API_KEY: 'valid-key-12345678901234567890' })).toThrow(ValidationError);
    });

    test('should reject short API keys', () => {
      const keys = {
        ANTHROPIC_API_KEY: 'short',
        ELEVENLABS_API_KEY: 'also-short'
      };
      expect(() => validateApiKeys(keys)).toThrow(ValidationError);
    });
  });

  describe('validateCommandLineArgs', () => {
    test('should parse valid command line arguments', () => {
      const args = ['--silent', '--whisper', 'test-file.mp3'];
      const result = validateCommandLineArgs(args);
      expect(result.flags).toContain('silent');
      expect(result.flags).toContain('whisper');
      expect(result.filePath).toBe(path.normalize('test-file.mp3'));
    });

    test('should reject unknown flags', () => {
      const args = ['--unknown-flag'];
      expect(() => validateCommandLineArgs(args)).toThrow(ValidationError);
    });

    test('should handle empty arguments', () => {
      const result = validateCommandLineArgs([]);
      expect(result.flags).toEqual([]);
      expect(result.filePath).toBeNull();
    });
  });

  describe('sanitizeFilename', () => {
    test('should remove dangerous characters', () => {
      const dangerous = 'file<>:"/\\|?*name.txt';
      const result = sanitizeFilename(dangerous);
      expect(result).toBe('filename.txt');
    });

    test('should replace spaces with underscores', () => {
      const spaced = 'my file name.txt';
      const result = sanitizeFilename(spaced);
      expect(result).toBe('my_file_name.txt');
    });

    test('should remove leading and trailing dots', () => {
      const dotted = '...filename.txt...';
      const result = sanitizeFilename(dotted);
      expect(result).toBe('filename.txt');
    });

    test('should limit filename length', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });

    test('should reject invalid input', () => {
      expect(() => sanitizeFilename('')).toThrow(ValidationError);
      expect(() => sanitizeFilename(null)).toThrow(ValidationError);
      expect(() => sanitizeFilename(123)).toThrow(ValidationError);
    });
  });
});

describe('Error Handling', () => {
  test('ValidationError should have correct properties', () => {
    const error = new ValidationError('Test message', 'testField');
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Test message');
    expect(error.field).toBe('testField');
    expect(error.timestamp).toBeDefined();
  });
});
