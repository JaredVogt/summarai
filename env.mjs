/**
 * Dedicated environment variables loader
 * This module loads .env files and should be imported first by all entry points
 * to ensure environment variables are available before any other modules run
 */

import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { validateApiKeys, ValidationError } from './src/validation.mjs';

// Simple logging for environment loading (before main logger is available)
const envLog = {
  success: (msg) => console.log(`✓ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  info: (msg) => console.log(`ℹ️ ${msg}`)
};

// Load .env files - load both project-specific and home directory files
const possibleEnvPaths = [
  path.join(process.cwd(), '.env'),
  path.join(os.homedir(), '.env')
];

const loadedFiles = [];

// Load all existing .env files (project config first, then home directory with API keys)
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    loadedFiles.push(envPath);
    envLog.success(`Loaded environment variables from ${envPath}`);
  }
}

if (loadedFiles.length === 0) {
  envLog.error('.env file not found in any of these locations:');
  possibleEnvPaths.forEach(p => console.error(`  - ${p}`));
  console.error('\nPlease create a .env file with your API keys.');
  process.exit(1);
}

// Validate API keys after loading environment variables
try {
  validateApiKeys();
  envLog.success('API keys validated successfully');
} catch (error) {
  if (error instanceof ValidationError) {
    envLog.error(`API Key Validation Failed: ${error.message}`);
    console.error('\nPlease check your .env file and ensure all required API keys are present and valid.');
    console.error('Required keys: ANTHROPIC_API_KEY, ELEVENLABS_API_KEY');
    process.exit(1);
  } else {
    envLog.error(`Unexpected error during API key validation: ${error.message}`);
    process.exit(1);
  }
}

// Export a flag to indicate successful loading (though this is mainly a side-effect module)
export const environmentLoaded = true;