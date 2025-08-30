import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// We'll use a basic YAML parser to avoid adding dependencies for now
// This is a simple YAML parser for our specific use case
function parseSimpleYAML(yamlContent) {
  const lines = yamlContent.split('\n');
  const result = {};
  const stack = [result];
  const indentLevels = [0];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const indent = line.length - line.trimStart().length;
    const colonIndex = trimmed.indexOf(':');
    
    if (colonIndex === -1) continue;
    
    const key = trimmed.substring(0, colonIndex).trim();
    const value = trimmed.substring(colonIndex + 1).trim();
    
    // Handle indentation levels
    while (indentLevels.length > 1 && indent <= indentLevels[indentLevels.length - 1]) {
      stack.pop();
      indentLevels.pop();
    }
    
    const currentObj = stack[stack.length - 1];
    
    if (value === '' || value === '{}' || value === '[]') {
      // Object or array
      if (value === '[]') {
        currentObj[key] = [];
      } else {
        currentObj[key] = {};
        stack.push(currentObj[key]);
        indentLevels.push(indent);
      }
    } else if (trimmed.startsWith('- ')) {
      // Array item
      const arrayValue = trimmed.substring(2).trim();
      if (!Array.isArray(currentObj)) {
        // Convert to array if not already
        const parent = stack[stack.length - 2];
        const parentKey = Object.keys(parent).find(k => parent[k] === currentObj);
        parent[parentKey] = [arrayValue];
      } else {
        currentObj.push(arrayValue);
      }
    } else {
      // Simple value
      currentObj[key] = parseValue(value);
    }
  }
  
  return result;
}

function parseValue(value) {
  // Remove inline comments
  const commentIndex = value.indexOf('#');
  if (commentIndex !== -1) {
    value = value.substring(0, commentIndex).trim();
  }
  
  // Handle quoted strings
  if ((value.startsWith('"') && value.endsWith('"')) || 
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  
  // Handle booleans
  if (value === 'true') return true;
  if (value === 'false') return false;
  
  // Handle null
  if (value === 'null' || value === '~') return null;
  
  // Handle numbers
  if (!isNaN(value) && !isNaN(parseFloat(value))) {
    return parseFloat(value);
  }
  
  // Handle multiline strings (basic support)
  if (value.startsWith('|')) {
    return value.substring(1).trim();
  }
  
  return value;
}

/**
 * Enhanced YAML parser with array support
 */
function parseYAML(yamlContent) {
  const lines = yamlContent.split('\n');
  const result = {};
  const stack = [{ obj: result, indent: -1 }];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const lineIndent = line.length - line.trimStart().length;
    
    // Pop stack until we find the right parent
    while (stack.length > 1 && lineIndent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    
    const currentObj = stack[stack.length - 1].obj;
    
    // Handle arrays
    if (trimmed.startsWith('- ')) {
      const arrayValue = trimmed.substring(2).trim();
      
      // Find the parent key by looking at the stack
      let arrayKey = null;
      let targetObj = null;
      
      // Look for the parent key that should contain this array
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].lastKey) {
          arrayKey = stack[j].lastKey;
          targetObj = j > 0 ? stack[j - 1].obj : currentObj;
          break;
        }
      }
      
      if (arrayKey && targetObj) {
        if (!Array.isArray(targetObj[arrayKey])) {
          targetObj[arrayKey] = [];
        }
        targetObj[arrayKey].push(parseValue(arrayValue));
      }
      continue;
    }
    
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;
    
    const key = trimmed.substring(0, colonIndex).trim();
    const value = trimmed.substring(colonIndex + 1).trim();
    
    if (value === '' || value === '{}') {
      // This is an object or array container
      currentObj[key] = {};
      stack.push({ obj: currentObj[key], indent: lineIndent, lastKey: key });
      
      // Update parent's lastKey for potential arrays
      if (stack.length >= 2) {
        stack[stack.length - 2].lastKey = key;
      }
    } else {
      currentObj[key] = parseValue(value);
    }
  }
  
  return result;
}

function parseNestedObject(lines, startIndex, parentIndent) {
  const obj = {};
  let i = startIndex;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    
    const lineIndent = line.length - line.trimStart().length;
    
    // If indentation is same or less than parent, we're done with this object
    if (lineIndent <= parentIndent) {
      break;
    }
    
    // Handle arrays
    if (trimmed.startsWith('- ')) {
      const arrayValue = trimmed.substring(2).trim();
      
      // Find the parent key
      let parentKey = null;
      for (let j = i - 1; j >= 0; j--) {
        const prevLine = lines[j].trim();
        if (!prevLine || prevLine.startsWith('#')) continue;
        
        const prevIndent = lines[j].length - lines[j].trimStart().length;
        if (prevIndent < lineIndent && prevLine.endsWith(':')) {
          parentKey = prevLine.substring(0, prevLine.length - 1).trim();
          break;
        }
      }
      
      if (parentKey) {
        if (!Array.isArray(obj[parentKey])) {
          obj[parentKey] = [];
        }
        obj[parentKey].push(parseValue(arrayValue));
      }
      
      i++;
      continue;
    }
    
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      i++;
      continue;
    }
    
    const key = trimmed.substring(0, colonIndex).trim();
    const value = trimmed.substring(colonIndex + 1).trim();
    
    if (value === '' || value === '{}') {
      // Nested object
      const nested = parseNestedObject(lines, i + 1, lineIndent);
      obj[key] = nested.obj;
      i = nested.nextIndex - 1;
    } else {
      obj[key] = parseValue(value);
    }
    
    i++;
  }
  
  return { obj, nextIndex: i };
}

/**
 * Expands tilde (~) to user's home directory
 */
function expandPath(filePath) {
  if (typeof filePath !== 'string') return filePath;
  
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.substring(2));
  }
  
  return filePath;
}

/**
 * Recursively expand paths in configuration object
 */
function expandPaths(obj) {
  if (typeof obj === 'string') {
    return expandPath(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(expandPaths);
  }
  
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandPaths(value);
    }
    return result;
  }
  
  return obj;
}

/**
 * Apply environment variable overrides
 */
function applyEnvOverrides(config) {
  const result = JSON.parse(JSON.stringify(config)); // Deep clone
  
  // Look for environment variables with PROCESSVM_ prefix
  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (!envKey.startsWith('PROCESSVM_')) continue;
    
    // Convert PROCESSVM_SECTION_SUBSECTION_KEY to nested object path
    const path = envKey.substring(10).toLowerCase().split('_');
    
    // Navigate to the correct position in config
    let current = result;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) current[path[i]] = {};
      current = current[path[i]];
    }
    
    // Set the value
    const key = path[path.length - 1];
    current[key] = parseValue(envValue);
  }
  
  return result;
}

/**
 * Validate configuration
 */
function validateConfig(config) {
  const errors = [];
  
  // Check required directories
  if (!config.directories?.voiceMemos) {
    errors.push('directories.voiceMemos is required');
  }
  
  if (!config.directories?.output) {
    errors.push('directories.output is required');
  }
  
  // Check transcription service
  if (!config.transcription?.defaultService) {
    errors.push('transcription.defaultService is required');
  }
  
  const validServices = ['whisper', 'scribe'];
  if (config.transcription?.defaultService && 
      !validServices.includes(config.transcription.defaultService)) {
    errors.push(`transcription.defaultService must be one of: ${validServices.join(', ')}`);
  }
  
  // Check file extensions
  if (!config.fileProcessing?.supportedExtensions) {
    errors.push('fileProcessing.supportedExtensions is required');
  }
  
  return errors;
}

/**
 * Load and parse configuration
 */
export function loadConfig(configPath = null) {
  // Determine config file path
  if (!configPath) {
    // Check if running as executable - look for config in current working directory first
    const possiblePaths = [
      path.join(process.cwd(), 'config.yaml'),
      path.join(__dirname, 'config.yaml')
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        configPath = p;
        break;
      }
    }
    
    if (!configPath) {
      configPath = possiblePaths[0]; // Default to first path for error message
    }
  }
  
  // Check if config file exists
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }
  
  try {
    // Read and parse YAML
    const yamlContent = fs.readFileSync(configPath, 'utf8');
    let config = parseYAML(yamlContent);
    
    // Expand file paths
    config = expandPaths(config);
    
    // Apply environment overrides if enabled
    if (config.envOverride !== false) {
      config = applyEnvOverrides(config);
    }
    
    // Validate configuration
    const errors = validateConfig(config);
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\\n${errors.join('\\n')}`);
    }
    
    return config;
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error.message}`);
  }
}

/**
 * Get a nested configuration value
 */
export function getConfigValue(config, path, defaultValue = null) {
  const parts = path.split('.');
  let current = config;
  
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return defaultValue;
    }
    current = current[part];
  }
  
  return current !== undefined ? current : defaultValue;
}

/**
 * Check if configuration file exists
 */
export function configExists(configPath = null) {
  if (!configPath) {
    // Check if running as executable - look for config in current working directory first
    const possiblePaths = [
      path.join(process.cwd(), 'config.yaml'),
      path.join(__dirname, 'config.yaml')
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return true;
      }
    }
    return false;
  }
  return fs.existsSync(configPath);
}

// Export default configuration for fallback
export const defaultConfig = {
  directories: {
    voiceMemos: '~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings',
    output: './output',
    temp: './temp'
  },
  transcription: {
    defaultService: 'scribe'
  },
  fileProcessing: {
    supportedExtensions: {
      audio: ['.m4a', '.mp3', '.wav'],
      video: ['.mp4', '.mov']
    }
  }
};