import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { sanitizeFilename } from '../src/validation.mjs';
import {
  ProcessingError,
  ValidationError,
  formatError,
  getErrorSeverity,
  ErrorSeverity
} from '../src/errors.mjs';

// Set up test environment variables
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-12345678901234567890';
process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key-12345678901234567890';

describe('Basic Functionality Tests', () => {
  describe('Utils Functions', () => {
    test('sanitizeFilename removes invalid characters', () => {
      const result = sanitizeFilename('test/file:name?.txt');
      expect(result).toBe('testfilename.txt');
    });

    test('sanitizeFilename replaces spaces with underscores', () => {
      const result = sanitizeFilename('my test file.mp3');
      expect(result).toBe('my_test_file.mp3');
    });

    test('sanitizeFilename limits length', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });
  });

  describe('Error Handling Framework', () => {
    test('ProcessingError has correct properties', () => {
      const error = new ProcessingError('Test processing error', { file: 'test.mp3' });
      expect(error.name).toBe('ProcessingError');
      expect(error.code).toBe('PROCESSING_FAILED');
      expect(error.details.file).toBe('test.mp3');
      expect(error.isOperational).toBe(true);
      expect(error.timestamp).toBeDefined();
    });

    test('ValidationError has correct properties', () => {
      const error = new ValidationError('Invalid input', 'testField', 'badValue');
      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.field).toBe('testField');
      expect(error.details.value).toBe('badValue');
    });

    test('getErrorSeverity returns correct levels', () => {
      const processingError = new ProcessingError('Test error');
      const validationError = new ValidationError('Invalid', 'field');
      
      expect(getErrorSeverity(processingError)).toBe(ErrorSeverity.MEDIUM);
      expect(getErrorSeverity(validationError)).toBe(ErrorSeverity.MEDIUM);
      
      const systemError = new Error('ENOENT: file not found');
      systemError.code = 'ENOENT';
      expect(getErrorSeverity(systemError)).toBe(ErrorSeverity.HIGH);
    });

    test('formatError creates proper error info', () => {
      const error = new ProcessingError('Test error', { file: 'test.mp3' });
      const formatted = formatError(error, 'test context');
      
      expect(formatted.severity).toBe(ErrorSeverity.MEDIUM);
      expect(formatted.context).toBe('test context');
      expect(formatted.name).toBe('ProcessingError');
      expect(formatted.message).toBe('Test error');
      expect(formatted.details.file).toBe('test.mp3');
      expect(formatted.timestamp).toBeDefined();
    });
  });

  describe('File Operations', () => {
    let testDir;
    let testFile;

    beforeEach(() => {
      testDir = path.join(process.cwd(), 'test-temp');
      testFile = path.join(testDir, 'test-file.txt');
      
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      
      fs.writeFileSync(testFile, 'test content');
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    test('test file exists and is readable', () => {
      expect(fs.existsSync(testFile)).toBe(true);
      const content = fs.readFileSync(testFile, 'utf8');
      expect(content).toBe('test content');
    });

    test('can create and clean up directories', () => {
      const subDir = path.join(testDir, 'subdir');
      fs.mkdirSync(subDir);
      expect(fs.existsSync(subDir)).toBe(true);
      
      fs.rmSync(subDir, { recursive: true });
      expect(fs.existsSync(subDir)).toBe(false);
    });
  });

  describe('Configuration Loading', () => {
    test('config file exists', () => {
      const configPath = path.join(process.cwd(), 'config.yaml');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    test('example config file exists', () => {
      const exampleConfigPath = path.join(process.cwd(), 'example.config.yaml');
      expect(fs.existsSync(exampleConfigPath)).toBe(true);
    });
  });

  describe('Environment Variables', () => {
    test('required environment variables are set', () => {
      // These should be set by the test setup
      expect(process.env.ANTHROPIC_API_KEY).toBeDefined();
      expect(process.env.ELEVENLABS_API_KEY).toBeDefined();
      expect(process.env.ANTHROPIC_API_KEY.length).toBeGreaterThan(20);
      expect(process.env.ELEVENLABS_API_KEY.length).toBeGreaterThan(20);
    });
  });

  describe('Module Imports', () => {
    test('can import core modules without errors', async () => {
      // Test that core modules can be imported
      expect(() => require('../utils.mjs')).not.toThrow();
      expect(() => require('../src/errors.mjs')).not.toThrow();
      expect(() => require('../src/validation.mjs')).not.toThrow();
    });
  });
});

describe('Integration Tests', () => {
  describe('Error Handling Integration', () => {
    test('validation errors are properly formatted', () => {
      try {
        throw new ValidationError('Test validation error', 'testField');
      } catch (error) {
        const formatted = formatError(error, 'test context');
        expect(formatted.severity).toBe(ErrorSeverity.MEDIUM);
        expect(formatted.field).toBe('testField');
      }
    });

    test('processing errors include context', () => {
      try {
        throw new ProcessingError('Test processing error', { 
          filePath: '/test/file.mp3',
          operation: 'transcribe' 
        });
      } catch (error) {
        const formatted = formatError(error, 'processVoiceMemo');
        expect(formatted.details.filePath).toBe('/test/file.mp3');
        expect(formatted.details.operation).toBe('transcribe');
        expect(formatted.context).toBe('processVoiceMemo');
      }
    });
  });

  describe('File System Integration', () => {
    test('can handle file system errors gracefully', () => {
      try {
        fs.readFileSync('/nonexistent/file.txt');
      } catch (error) {
        expect(error.code).toBe('ENOENT');
        const severity = getErrorSeverity(error);
        expect(severity).toBe(ErrorSeverity.HIGH);
      }
    });
  });
});

describe('Security Tests', () => {
  describe('Input Sanitization', () => {
    test('sanitizeFilename prevents directory traversal', () => {
      const malicious = '../../../etc/passwd';
      const result = sanitizeFilename(malicious);
      expect(result).not.toContain('..');
      expect(result).not.toContain('/');
    });

    test('sanitizeFilename removes null bytes', () => {
      const malicious = 'file\0name.txt';
      const result = sanitizeFilename(malicious);
      expect(result).not.toContain('\0');
    });

    test('sanitizeFilename handles special characters', () => {
      const special = 'file<>:"|?*name.txt';
      const result = sanitizeFilename(special);
      expect(result).toBe('filename.txt');
    });
  });
});
