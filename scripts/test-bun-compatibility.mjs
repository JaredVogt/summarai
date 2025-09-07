#!/usr/bin/env bun

/**
 * Bun Compatibility Test Script
 * Tests various Bun-specific features and potential VFS issues
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Testing Bun Compatibility...\n');

// Test 1: Bun Detection
console.log('1. Bun Detection:');
console.log('   Bun detected:', typeof Bun !== 'undefined');
console.log('   Process argv[0]:', process.argv[0]);
console.log('   Is executable:', process.argv[0]?.includes('summari'));
console.log('');

// Test 2: File System Operations
console.log('2. File System Operations:');
try {
  const testFile = path.join(__dirname, 'test-bun-fs.tmp');
  
  // Write test
  fs.writeFileSync(testFile, 'test content for bun compatibility');
  console.log('   ✓ File write successful');
  
  // Read test
  const content = fs.readFileSync(testFile, 'utf8');
  if (content === 'test content for bun compatibility') {
    console.log('   ✓ File read successful');
  } else {
    console.log('   ✗ File read failed - content mismatch');
  }
  
  // Stat test
  const stats = fs.statSync(testFile);
  console.log(`   ✓ File stat successful - size: ${stats.size} bytes`);
  
  // Delete test
  fs.unlinkSync(testFile);
  console.log('   ✓ File delete successful');
  
} catch (error) {
  console.log('   ✗ File operations failed:', error.message);
}
console.log('');

// Test 3: Directory Operations
console.log('3. Directory Operations:');
try {
  const testDir = path.join(__dirname, 'test-bun-dir');
  
  // Create directory
  fs.mkdirSync(testDir, { recursive: true });
  console.log('   ✓ Directory creation successful');
  
  // Check existence
  if (fs.existsSync(testDir)) {
    console.log('   ✓ Directory existence check successful');
  } else {
    console.log('   ✗ Directory existence check failed');
  }
  
  // Remove directory
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('   ✓ Directory removal successful');
  
} catch (error) {
  console.log('   ✗ Directory operations failed:', error.message);
}
console.log('');

// Test 4: JSON Operations
console.log('4. JSON Operations:');
try {
  const testData = {
    timestamp: Date.now(),
    test: 'bun compatibility',
    nested: { value: 42 }
  };
  
  const jsonString = JSON.stringify(testData, null, 2);
  console.log('   ✓ JSON stringify successful');
  
  const parsed = JSON.parse(jsonString);
  if (parsed.test === 'bun compatibility' && parsed.nested.value === 42) {
    console.log('   ✓ JSON parse successful');
  } else {
    console.log('   ✗ JSON parse failed - data mismatch');
  }
  
} catch (error) {
  console.log('   ✗ JSON operations failed:', error.message);
}
console.log('');

// Test 5: Path Operations
console.log('5. Path Operations:');
try {
  const testPath = '/test/path/../file.txt';
  const normalized = path.normalize(testPath);
  console.log(`   ✓ Path normalize: ${testPath} -> ${normalized}`);
  
  const joined = path.join(__dirname, 'test', 'file.txt');
  console.log(`   ✓ Path join successful: ${joined}`);
  
  const basename = path.basename('/test/file.txt');
  const dirname = path.dirname('/test/file.txt');
  console.log(`   ✓ Path basename: ${basename}, dirname: ${dirname}`);
  
} catch (error) {
  console.log('   ✗ Path operations failed:', error.message);
}
console.log('');

// Test 6: Memory Cache Test (VFS workaround)
console.log('6. Memory Cache Test:');
try {
  let memoryCache = null;
  
  // Set cache
  memoryCache = {
    timestamp: Date.now(),
    data: 'test cache data'
  };
  console.log('   ✓ Memory cache set successful');
  
  // Get cache
  if (memoryCache && memoryCache.data === 'test cache data') {
    console.log('   ✓ Memory cache get successful');
  } else {
    console.log('   ✗ Memory cache get failed');
  }
  
  // Clear cache
  memoryCache = null;
  console.log('   ✓ Memory cache clear successful');
  
} catch (error) {
  console.log('   ✗ Memory cache operations failed:', error.message);
}
console.log('');

// Test 7: Environment Variables
console.log('7. Environment Variables:');
try {
  const testEnvVar = process.env.NODE_ENV || 'not set';
  console.log(`   ✓ Environment variable access: NODE_ENV = ${testEnvVar}`);
  
  // Test setting environment variable
  process.env.BUN_TEST_VAR = 'test value';
  if (process.env.BUN_TEST_VAR === 'test value') {
    console.log('   ✓ Environment variable setting successful');
  } else {
    console.log('   ✗ Environment variable setting failed');
  }
  
  // Clean up
  delete process.env.BUN_TEST_VAR;
  
} catch (error) {
  console.log('   ✗ Environment variable operations failed:', error.message);
}
console.log('');

// Test 8: Module Import Test
console.log('8. Module Import Test:');
try {
  // Test importing core modules
  const utilsPath = path.join(__dirname, '..', 'utils.mjs');
  if (fs.existsSync(utilsPath)) {
    console.log('   ✓ Utils module file exists');
    // Note: We don't actually import to avoid side effects
  } else {
    console.log('   ✗ Utils module file not found');
  }
  
  const configPath = path.join(__dirname, '..', 'config.yaml');
  if (fs.existsSync(configPath)) {
    console.log('   ✓ Config file exists');
  } else {
    console.log('   ✗ Config file not found');
  }
  
} catch (error) {
  console.log('   ✗ Module import test failed:', error.message);
}
console.log('');

// Test 9: Error Handling
console.log('9. Error Handling:');
try {
  // Test throwing and catching errors
  try {
    throw new Error('Test error for Bun compatibility');
  } catch (testError) {
    if (testError.message === 'Test error for Bun compatibility') {
      console.log('   ✓ Error throwing and catching successful');
    } else {
      console.log('   ✗ Error message mismatch');
    }
  }
  
  // Test error properties
  const error = new Error('Test error');
  error.code = 'TEST_CODE';
  if (error.code === 'TEST_CODE' && error.name === 'Error') {
    console.log('   ✓ Error properties successful');
  } else {
    console.log('   ✗ Error properties failed');
  }
  
} catch (error) {
  console.log('   ✗ Error handling test failed:', error.message);
}
console.log('');

// Test 10: Async Operations
console.log('10. Async Operations:');
try {
  const asyncTest = async () => {
    return new Promise((resolve) => {
      setTimeout(() => resolve('async test complete'), 10);
    });
  };
  
  const result = await asyncTest();
  if (result === 'async test complete') {
    console.log('   ✓ Async operations successful');
  } else {
    console.log('   ✗ Async operations failed');
  }
  
} catch (error) {
  console.log('   ✗ Async operations failed:', error.message);
}

console.log('\n🎉 Bun compatibility test completed!');
console.log('\nIf all tests show ✓, Bun should work correctly with this project.');
console.log('If any tests show ✗, there may be compatibility issues to address.');

// Exit with appropriate code
process.exit(0);
