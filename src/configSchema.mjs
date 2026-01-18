import { z } from 'zod';

/**
 * Zod schema for watch.stability.validation configuration section
 */
export const watchValidationSchema = z.object({
  enabled: z.boolean().default(true),
  level: z.enum(['moov', 'full', 'basic']).default('moov'),
  minFileSize: z.number().positive().default(1024),
  retryMaxAttempts: z.number().int().positive().default(3),
  retryDelays: z.array(z.number()).default([5000, 15000, 30000])
}).optional();

/**
 * Zod schema for watch.stability configuration section
 */
export const watchStabilitySchema = z.object({
  threshold: z.number().positive().optional(),
  pollInterval: z.number().positive().optional(),
  mdlsCheck: z.object({
    enabled: z.boolean().optional(),
    attempts: z.number().int().positive().optional(),
    delayMs: z.number().positive().optional()
  }).optional(),
  tailRead: z.object({
    enabled: z.boolean().optional(),
    attempts: z.number().int().positive().optional(),
    delayMs: z.number().positive().optional(),
    tailBytes: z.number().positive().optional()
  }).optional(),
  validation: watchValidationSchema
}).optional();

/**
 * Zod schema for watch configuration section
 */
export const watchSchema = z.object({
  enabled: z.record(z.string(), z.boolean()).optional(),
  initialProcessing: z.object({
    cleanout: z.boolean().optional(),
    processRecentVm: z.boolean().optional(),
    defaultDateRange: z.number().positive().optional()
  }).optional(),
  stability: watchStabilitySchema,
  queue: z.object({
    delayBetweenFiles: z.number().positive().optional(),
    initialDelay: z.number().positive().optional()
  }).optional()
}).optional();

/**
 * Zod schema for directories configuration
 */
export const directoriesSchema = z.object({
  voiceMemos: z.string().optional(),
  output: z.string().optional(),
  temp: z.string().optional(),
  watch: z.record(z.string(), z.object({
    name: z.string(),
    path: z.string(),
    outputSubdir: z.string().optional()
  })).optional()
}).optional();

/**
 * Zod schema for transcription configuration
 */
export const transcriptionSchema = z.object({
  defaultService: z.enum(['whisper', 'scribe']),
  whisper: z.object({
    model: z.string().optional(),
    language: z.string().nullable().optional(),
    temperature: z.number().optional(),
    responseFormat: z.string().optional(),
    nomenclaturePrompt: z.string().optional()
  }).optional(),
  scribe: z.object({
    model: z.string().optional(),
    language: z.string().optional(),
    tagAudioEvents: z.boolean().optional(),
    diarize: z.boolean().optional(),
    maxSpeakers: z.number().nullable().optional(),
    timeoutSeconds: z.number().optional()
  }).optional()
}).optional();

/**
 * Zod schema for file processing configuration
 */
export const fileProcessingSchema = z.object({
  supportedExtensions: z.object({
    audio: z.array(z.string()).optional(),
    video: z.array(z.string()).optional()
  }).optional(),
  output: z.object({
    createSegmentsFile: z.boolean().optional()
  }).optional()
}).optional();

/**
 * Full configuration schema - uses passthrough() to allow unknown keys
 * This provides validation for known fields while permitting extension
 */
export const configSchema = z.object({
  directories: directoriesSchema,
  watch: watchSchema,
  transcription: transcriptionSchema,
  fileProcessing: fileProcessingSchema,
  audio: z.object({
    compression: z.object({}).passthrough().optional(),
    processing: z.object({}).passthrough().optional(),
    chunking: z.object({
      enabled: z.boolean().optional(),
      maxSizeMB: z.number().optional(),
      chunkPrefix: z.string().optional()
    }).optional()
  }).passthrough().optional(),
  processing: z.object({
    sentence_pause_threshold: z.number().optional(),
    max_words_per_segment: z.number().optional()
  }).passthrough().optional(),
  api: z.object({}).passthrough().optional(),
  claude: z.object({}).passthrough().optional(),
  logging: z.object({}).passthrough().optional(),
  filters: z.object({}).passthrough().optional()
}).passthrough();

/**
 * Validate configuration against schema
 * @param {object} config - Configuration object to validate
 * @returns {{ success: boolean, data?: object, errors?: string[] }}
 */
export function validateConfig(config) {
  const result = configSchema.safeParse(config);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map(issue => {
    const path = issue.path.join('.');
    return `${path}: ${issue.message}`;
  });

  return { success: false, errors };
}

/**
 * Validate just the watch.stability.validation section
 * @param {object} validationConfig - Validation config object
 * @returns {{ success: boolean, data?: object, errors?: string[] }}
 */
export function validateWatchValidation(validationConfig) {
  const result = watchValidationSchema.safeParse(validationConfig);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map(issue => {
    const path = issue.path.join('.');
    return `${path}: ${issue.message}`;
  });

  return { success: false, errors };
}
