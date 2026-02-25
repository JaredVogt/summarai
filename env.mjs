/**
 * Dedicated environment variables loader
 * This module loads .env files and should be imported first by all entry points
 * to ensure environment variables are available before any other modules run
 */

import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { validateRequiredApiKeys, ValidationError } from './src/validation.mjs';

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

// If no .env files found, check if required env vars are already set
if (loadedFiles.length === 0) {
  // Check for minimum required keys: ANTHROPIC_API_KEY for summarization,
  // and at least one transcription key (ELEVENLABS or OPENAI)
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasTranscriptionKey = !!(process.env.ELEVENLABS_API_KEY || process.env.OPENAI_API_KEY);

  if (hasAnthropicKey && hasTranscriptionKey) {
    envLog.info('No .env file found, but required environment variables are already set');
  } else {
    const missingKeys = [];
    if (!hasAnthropicKey) missingKeys.push('ANTHROPIC_API_KEY');
    if (!hasTranscriptionKey) missingKeys.push('ELEVENLABS_API_KEY or OPENAI_API_KEY');

    envLog.error('.env file not found and required environment variables are missing:');
    missingKeys.forEach(k => console.error(`  - ${k}`));
    console.error('\nSearched for .env files in:');
    possibleEnvPaths.forEach(p => console.error(`  - ${p}`));
    console.error('\nPlease create a .env file with your API keys or set them as environment variables.');
    process.exit(1);
  }
}

// Determine transcription service from environment or default to scribe
// (Config not yet loaded, so we check env var or default)
const transcriptionService = process.env.TRANSCRIPTION_SERVICE || 'scribe';

// Validate API keys after loading environment variables
try {
  validateRequiredApiKeys({
    transcriptionService,
    summarization: true // Always require summarization key for now
  });
  envLog.success('API keys validated successfully');
} catch (error) {
  if (error instanceof ValidationError) {
    envLog.error(`API Key Validation Failed: ${error.message}`);
    console.error('\nPlease check your .env file and ensure all required API keys are present and valid.');
    console.error('Required keys depend on your configuration:');
    console.error('  - ANTHROPIC_API_KEY (for Claude summarization)');
    console.error('  - ELEVENLABS_API_KEY (for ElevenLabs Scribe transcription) OR');
    console.error('  - OPENAI_API_KEY (for OpenAI Whisper transcription)');
    process.exit(1);
  } else {
    envLog.error(`Unexpected error during API key validation: ${error.message}`);
    process.exit(1);
  }
}

// Export a flag to indicate successful loading (though this is mainly a side-effect module)
export const environmentLoaded = true;