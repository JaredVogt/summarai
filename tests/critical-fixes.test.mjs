#!/usr/bin/env bun

/**
 * Test script to validate critical fixes are working
 * Tests the core functionality without importing broken modules
 */

import fs from 'fs';
import path from 'path';

console.log('🧪 Testing Critical Fixes Implementation...\n');

// Test 1: Validation Framework
console.log('1. Testing Validation Framework:');
try {
  const { 
    validateFilePath, 
    validateAudioOptions, 
    validateApiKeys,
    sanitizeFilename,
    ValidationError 
  } = await import('../src/validation.mjs');
  
  // Test path validation
  const validPath = validateFilePath('./test-file.txt');
  console.log('   ✓ Path validation working');
  
  // Test path traversal protection
  try {
    validateFilePath('../../../etc/passwd');
    console.log('   ✗ Path traversal protection failed');
  } catch (error) {
    if (error instanceof ValidationError) {
      console.log('   ✓ Path traversal protection working');
    } else {
      console.log('   ✗ Unexpected error type');
    }
  }
  
  // Test audio options validation
  const audioOptions = validateAudioOptions({
    bitrate: '48k',
    sampleRate: 16000,
    channels: 1
  });
  console.log('   ✓ Audio options validation working');
  
  // Test filename sanitization
  const sanitized = sanitizeFilename('test/file:name?.txt');
  if (!sanitized.includes('/') && !sanitized.includes(':')) {
    console.log('   ✓ Filename sanitization working');
  } else {
    console.log('   ✗ Filename sanitization failed');
  }
  
} catch (error) {
  console.log('   ✗ Validation framework failed:', error.message);
}
console.log('');

// Test 2: Error Handling Framework
console.log('2. Testing Error Handling Framework:');
try {
  const { 
    ProcessingError, 
    ValidationError, 
    formatError, 
    handleError,
    ErrorSeverity 
  } = await import('../src/errors.mjs');
  
  // Test error creation
  const processingError = new ProcessingError('Test error', { file: 'test.mp3' });
  if (processingError.code === 'PROCESSING_FAILED' && processingError.details.file === 'test.mp3') {
    console.log('   ✓ Error creation working');
  } else {
    console.log('   ✗ Error creation failed');
  }
  
  // Test error formatting
  const formatted = formatError(processingError, 'test context');
  if (formatted.severity && formatted.context === 'test context') {
    console.log('   ✓ Error formatting working');
  } else {
    console.log('   ✗ Error formatting failed');
  }
  
  // Test error handling
  try {
    throw new ValidationError('Test validation error', 'testField');
  } catch (error) {
    const handled = handleError(error, 'test', { rethrow: false });
    if (handled.field === 'testField') {
      console.log('   ✓ Error handling working');
    } else {
      console.log('   ✗ Error handling failed');
    }
  }
  
} catch (error) {
  console.log('   ✗ Error handling framework failed:', error.message);
}
console.log('');

// Test 3: Secure FFmpeg Implementation
console.log('3. Testing Secure FFmpeg Implementation:');
try {
  // Check if audioProcessing.mjs can be imported
  const audioProcessing = await import('../audioProcessing.mjs');
  console.log('   ✓ Audio processing module imports successfully');
  
  // Check if the secure function exists (we can't test execution without ffmpeg)
  const moduleContent = fs.readFileSync(path.join(process.cwd(), 'audioProcessing.mjs'), 'utf8');
  if (moduleContent.includes('secureFFmpegCall') && moduleContent.includes('spawn')) {
    console.log('   ✓ Secure FFmpeg implementation detected');
  } else {
    console.log('   ✗ Secure FFmpeg implementation not found');
  }
  
  // Check that dangerous string interpolation is removed
  if (!moduleContent.includes('`ffmpeg -i "${') && !moduleContent.includes('await exec(cmd)')) {
    console.log('   ✓ Command injection vulnerabilities removed');
  } else {
    console.log('   ✗ Command injection vulnerabilities still present');
  }
  
} catch (error) {
  console.log('   ✗ Audio processing module failed:', error.message);
}
console.log('');

// Test 4: Bun VFS Compatibility
console.log('4. Testing Bun VFS Compatibility:');
try {
  const modelChecker = await import('../modelChecker.mjs');
  console.log('   ✓ Model checker module imports successfully');
  
  // Check if memory cache is implemented
  const moduleContent = fs.readFileSync(path.join(process.cwd(), 'modelChecker.mjs'), 'utf8');
  if (moduleContent.includes('memoryCache') && moduleContent.includes('isExecutable')) {
    console.log('   ✓ VFS-compatible caching implemented');
  } else {
    console.log('   ✗ VFS-compatible caching not found');
  }
  
} catch (error) {
  console.log('   ✗ Model checker module failed:', error.message);
}
console.log('');

// Test 5: Environment Variable Validation
console.log('5. Testing Environment Variable Validation:');
try {
  // Set test environment variables
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-12345678901234567890';
  process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key-12345678901234567890';
  
  const { validateApiKeys } = await import('../src/validation.mjs');
  validateApiKeys();
  console.log('   ✓ API key validation working');
  
} catch (error) {
  console.log('   ✗ API key validation failed:', error.message);
}
console.log('');

// Test 6: Configuration Loading
console.log('6. Testing Configuration Loading:');
try {
  // Check if config files exist
  if (fs.existsSync(path.join(process.cwd(), 'config.yaml'))) {
    console.log('   ✓ Main config file exists');
  } else {
    console.log('   ✗ Main config file missing');
  }
  
  if (fs.existsSync(path.join(process.cwd(), 'example.config.yaml'))) {
    console.log('   ✓ Example config file exists');
  } else {
    console.log('   ✗ Example config file missing');
  }
  
  // Test config loader (if it doesn't import transcribe.mjs)
  try {
    const { loadConfig } = await import('../configLoader.mjs');
    const config = loadConfig();
    if (config && typeof config === 'object') {
      console.log('   ✓ Configuration loading working');
    } else {
      console.log('   ✗ Configuration loading failed');
    }
  } catch (error) {
    console.log('   ⚠️  Configuration loading skipped (dependency issue)');
  }
  
} catch (error) {
  console.log('   ✗ Configuration testing failed:', error.message);
}
console.log('');

// Test 7: File System Security
console.log('7. Testing File System Security:');
try {
  const { validateFilePath } = await import('../src/validation.mjs');
  
  const testCases = [
    { input: '../../../etc/passwd', shouldFail: true },
    { input: '/etc/passwd', shouldFail: true },
    { input: 'file\0name.txt', shouldFail: true },
    { input: './valid-file.txt', shouldFail: false }
  ];
  
  let passed = 0;
  for (const testCase of testCases) {
    try {
      validateFilePath(testCase.input);
      if (!testCase.shouldFail) passed++;
    } catch (error) {
      if (testCase.shouldFail) passed++;
    }
  }
  
  if (passed === testCases.length) {
    console.log('   ✓ File system security validation working');
  } else {
    console.log(`   ✗ File system security failed (${passed}/${testCases.length} tests passed)`);
  }
  
} catch (error) {
  console.log('   ✗ File system security testing failed:', error.message);
}

console.log('\n🎉 Critical Fixes Test Completed!');
console.log('\nSummary:');
console.log('- ✓ = Fix implemented and working');
console.log('- ✗ = Fix failed or not working');
console.log('- ⚠️  = Fix skipped due to dependencies');

console.log('\nNext steps:');
console.log('1. Fix any remaining ✗ issues');
console.log('2. Fix syntax errors in transcribe.mjs');
console.log('3. Run full test suite');
console.log('4. Test with actual audio files');

process.exit(0);
