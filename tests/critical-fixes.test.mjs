#!/usr/bin/env bun

/**
 * Test script to validate critical fixes are working
 * Converted to use bun:test assertions for proper regression detection
 * Enhanced with actual failure scenarios and meaningful assertions
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Critical Fixes', () => {
  describe('Validation Framework', () => {
    test('imports validation module successfully', async () => {
      const module = await import('../src/validation.mjs');
      expect(module.validateFilePath).toBeDefined();
      expect(module.validateAudioOptions).toBeDefined();
      expect(module.validateApiKeys).toBeDefined();
      expect(module.sanitizeFilename).toBeDefined();
      expect(module.ValidationError).toBeDefined();
    });

    test('path validation works for valid paths', async () => {
      const { validateFilePath } = await import('../src/validation.mjs');
      const result = validateFilePath('./test-file.txt');
      expect(result).toBeDefined();
    });

    test('path traversal is blocked', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');
      expect(() => validateFilePath('../../../etc/passwd')).toThrow(ValidationError);
    });

    test('audio options validation works', async () => {
      const { validateAudioOptions } = await import('../src/validation.mjs');
      const audioOptions = validateAudioOptions({
        bitrate: '48k',
        sampleRate: 16000,
        channels: 1
      });
      expect(audioOptions).toBeDefined();
      expect(audioOptions.bitrate).toBe('48k');
      expect(audioOptions.sampleRate).toBe(16000);
    });

    test('filename sanitization removes dangerous characters', async () => {
      const { sanitizeFilename } = await import('../src/validation.mjs');
      const sanitized = sanitizeFilename('test/file:name?.txt');
      expect(sanitized).not.toContain('/');
      expect(sanitized).not.toContain(':');
      expect(sanitized).not.toContain('?');
    });

    // Enhanced validation tests with actual failure scenarios
    test('path validation error message is descriptive for traversal', async () => {
      const { validateFilePath } = await import('../src/validation.mjs');
      try {
        validateFilePath('../secret/file.txt');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error.message).toContain('path traversal');
        expect(error.field).toBe('filePath');
      }
    });

    test('path validation error message is descriptive for null byte', async () => {
      const { validateFilePath } = await import('../src/validation.mjs');
      try {
        validateFilePath('file\x00.txt');
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain('null byte');
      }
    });

    test('ValidationError includes timestamp', async () => {
      const { ValidationError } = await import('../src/validation.mjs');
      const error = new ValidationError('Test error', 'testField');
      expect(error.timestamp).toBeDefined();
      expect(typeof error.timestamp).toBe('string');
      // Should be valid ISO date
      expect(new Date(error.timestamp).toString()).not.toBe('Invalid Date');
    });

    test('sanitizeFilename edge cases', async () => {
      const { sanitizeFilename, ValidationError } = await import('../src/validation.mjs');

      // Multiple spaces become single underscore (uses \s+ replacement)
      expect(sanitizeFilename('file   name.txt')).toBe('file_name.txt');

      // Leading dots removed
      expect(sanitizeFilename('...hidden')).toBe('hidden');

      // Control characters removed
      expect(sanitizeFilename('file\x01\x02.txt')).toBe('file.txt');

      // Long filename truncated
      const longName = 'a'.repeat(300);
      expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(255);

      // Empty string throws
      expect(() => sanitizeFilename('')).toThrow(ValidationError);
    });

    test('audio options validation with edge cases', async () => {
      const { validateAudioOptions, ValidationError } = await import('../src/validation.mjs');

      // Valid boundary values
      expect(validateAudioOptions({ bitrate: '8k' }).bitrate).toBe('8k');
      expect(validateAudioOptions({ bitrate: '320k' }).bitrate).toBe('320k');

      // Invalid boundary values
      expect(() => validateAudioOptions({ bitrate: '7k' })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ bitrate: '321k' })).toThrow(ValidationError);

      // Speed adjustment boundaries
      expect(validateAudioOptions({ speedAdjustment: 0.5 }).speedAdjustment).toBe(0.5);
      expect(validateAudioOptions({ speedAdjustment: 3.0 }).speedAdjustment).toBe(3.0);
      expect(() => validateAudioOptions({ speedAdjustment: 0.4 })).toThrow(ValidationError);
      expect(() => validateAudioOptions({ speedAdjustment: 3.1 })).toThrow(ValidationError);
    });
  });

  describe('Error Handling Framework', () => {
    test('imports error module successfully', async () => {
      const module = await import('../src/errors.mjs');
      expect(module.ProcessingError).toBeDefined();
      expect(module.ValidationError).toBeDefined();
      expect(module.formatError).toBeDefined();
      expect(module.handleError).toBeDefined();
      expect(module.ErrorSeverity).toBeDefined();
    });

    test('ProcessingError creation works correctly', async () => {
      const { ProcessingError } = await import('../src/errors.mjs');
      const processingError = new ProcessingError('Test error', { file: 'test.mp3' });
      expect(processingError.code).toBe('PROCESSING_FAILED');
      expect(processingError.details.file).toBe('test.mp3');
    });

    test('error formatting works correctly', async () => {
      const { ProcessingError, formatError } = await import('../src/errors.mjs');
      const processingError = new ProcessingError('Test error', { file: 'test.mp3' });
      const formatted = formatError(processingError, 'test context');
      expect(formatted.severity).toBeDefined();
      expect(formatted.context).toBe('test context');
    });

    test('error handling works correctly', async () => {
      const { ValidationError, handleError } = await import('../src/errors.mjs');
      const error = new ValidationError('Test validation error', 'testField');
      const handled = handleError(error, 'test', { rethrow: false });
      expect(handled.field).toBe('testField');
    });

    // Enhanced error handling tests
    test('ProcessingError stores various detail types', async () => {
      const { ProcessingError } = await import('../src/errors.mjs');

      // Object details
      const errorWithObject = new ProcessingError('Test', { file: 'test.mp3', size: 1024 });
      expect(errorWithObject.details.file).toBe('test.mp3');
      expect(errorWithObject.details.size).toBe(1024);

      // Array details
      const errorWithArray = new ProcessingError('Test', { steps: ['step1', 'step2'] });
      expect(errorWithArray.details.steps).toEqual(['step1', 'step2']);

      // Nested details
      const errorWithNested = new ProcessingError('Test', {
        audio: { format: 'm4a', codec: 'aac' }
      });
      expect(errorWithNested.details.audio.format).toBe('m4a');
    });

    test('AppError hierarchy is correct', async () => {
      const { ProcessingError, ValidationError, ApiError, AppError } = await import('../src/errors.mjs');

      const procError = new ProcessingError('Test');
      const valError = new ValidationError('Test', 'field');
      const apiError = new ApiError('Test', 'anthropic', 500);

      // All extend AppError
      expect(procError).toBeInstanceOf(AppError);
      expect(valError).toBeInstanceOf(AppError);
      expect(apiError).toBeInstanceOf(AppError);

      // All extend Error
      expect(procError).toBeInstanceOf(Error);
      expect(valError).toBeInstanceOf(Error);
      expect(apiError).toBeInstanceOf(Error);
    });

    test('ApiError stores service and status code', async () => {
      const { ApiError } = await import('../src/errors.mjs');

      const error = new ApiError('Rate limited', 'elevenlabs', 429, { retryAfter: 60 });
      expect(error.service).toBe('elevenlabs');
      expect(error.statusCode).toBe(429);
      expect(error.details.retryAfter).toBe(60);
      expect(error.code).toBe('API_ERROR');
    });

    test('getErrorSeverity returns correct levels', async () => {
      const {
        ProcessingError, ValidationError, ApiError, ConfigurationError,
        getErrorSeverity, ErrorSeverity
      } = await import('../src/errors.mjs');

      expect(getErrorSeverity(new ConfigurationError('Test'))).toBe(ErrorSeverity.CRITICAL);
      expect(getErrorSeverity(new ApiError('Test', 'service', 500))).toBe(ErrorSeverity.HIGH);
      expect(getErrorSeverity(new ValidationError('Test', 'field'))).toBe(ErrorSeverity.MEDIUM);
      expect(getErrorSeverity(new ProcessingError('Test'))).toBe(ErrorSeverity.MEDIUM);

      // System errors
      const enoentError = new Error('File not found');
      enoentError.code = 'ENOENT';
      expect(getErrorSeverity(enoentError)).toBe(ErrorSeverity.HIGH);
    });

    test('formatError includes all expected fields', async () => {
      const { ProcessingError, formatError } = await import('../src/errors.mjs');

      const error = new ProcessingError('Transcription failed', {
        file: 'test.m4a',
        reason: 'API timeout'
      });

      const formatted = formatError(error, 'transcription');

      expect(formatted.timestamp).toBeDefined();
      expect(formatted.severity).toBe('medium');
      expect(formatted.context).toBe('transcription');
      expect(formatted.name).toBe('ProcessingError');
      expect(formatted.message).toBe('Transcription failed');
      expect(formatted.code).toBe('PROCESSING_FAILED');
      expect(formatted.details.file).toBe('test.m4a');
      expect(formatted.isOperational).toBe(true);
    });

    test('getUserFriendlyMessage hides sensitive information', async () => {
      const { getUserFriendlyMessage, ApiError } = await import('../src/errors.mjs');

      // System error with potentially sensitive path
      const fsError = new Error('ENOENT: no such file /home/user/secret/api_keys.json');
      fsError.code = 'ENOENT';
      const message = getUserFriendlyMessage(fsError);
      expect(message).not.toContain('secret');
      expect(message).not.toContain('api_keys');
      expect(message).toContain('File not found');
    });
  });

  describe('Secure FFmpeg Implementation', () => {
    test('audio processing module imports successfully', async () => {
      const audioProcessing = await import('../audioProcessing.mjs');
      expect(audioProcessing).toBeDefined();
    });

    test('secure FFmpeg implementation is present', () => {
      const moduleContent = fs.readFileSync(path.join(process.cwd(), 'audioProcessing.mjs'), 'utf8');
      expect(moduleContent).toContain('secureFFmpegCall');
      expect(moduleContent).toContain('spawn');
    });

    test('command injection vulnerabilities are removed', () => {
      const moduleContent = fs.readFileSync(path.join(process.cwd(), 'audioProcessing.mjs'), 'utf8');
      expect(moduleContent).not.toContain('`ffmpeg -i "${');
      expect(moduleContent).not.toContain('await exec(cmd)');
    });
  });

  describe('Bun VFS Compatibility', () => {
    test('model checker module imports successfully', async () => {
      const modelChecker = await import('../modelChecker.mjs');
      expect(modelChecker).toBeDefined();
    });

    test('VFS-compatible caching is implemented', () => {
      const moduleContent = fs.readFileSync(path.join(process.cwd(), 'modelChecker.mjs'), 'utf8');
      expect(moduleContent).toContain('memoryCache');
      expect(moduleContent).toContain('isExecutable');
    });
  });

  describe('Environment Variable Validation', () => {
    let originalAnthropicKey;
    let originalElevenLabsKey;

    beforeAll(() => {
      originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
      originalElevenLabsKey = process.env.ELEVENLABS_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-12345678901234567890';
      process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key-12345678901234567890';
    });

    afterAll(() => {
      if (originalAnthropicKey) {
        process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
      if (originalElevenLabsKey) {
        process.env.ELEVENLABS_API_KEY = originalElevenLabsKey;
      } else {
        delete process.env.ELEVENLABS_API_KEY;
      }
    });

    test('API key validation works', async () => {
      const { validateApiKeys } = await import('../src/validation.mjs');
      expect(() => validateApiKeys()).not.toThrow();
    });
  });

  describe('Configuration Loading', () => {
    test('main config file exists', () => {
      expect(fs.existsSync(path.join(process.cwd(), 'config.yaml'))).toBe(true);
    });

    test('example config file exists', () => {
      expect(fs.existsSync(path.join(process.cwd(), 'example.config.yaml'))).toBe(true);
    });

    test('configuration loading works', async () => {
      const { loadConfig } = await import('../configLoader.mjs');
      const config = loadConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });
  });

  describe('File System Security', () => {
    test('path traversal attack is blocked', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');
      expect(() => validateFilePath('../../../etc/passwd')).toThrow(ValidationError);
    });

    test('absolute path attack is blocked', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');
      expect(() => validateFilePath('/etc/passwd')).toThrow(ValidationError);
    });

    test('null byte injection is blocked', async () => {
      const { validateFilePath, ValidationError } = await import('../src/validation.mjs');
      expect(() => validateFilePath('file\0name.txt')).toThrow(ValidationError);
    });

    test('valid relative paths are accepted', async () => {
      const { validateFilePath } = await import('../src/validation.mjs');
      expect(() => validateFilePath('./valid-file.txt')).not.toThrow();
    });
  });
});
