# Claude Code Instructions for summarai

## Project Overview
summarai is an audio processing and transcription system that converts voice memos and audio files into clean, readable transcripts and AI-powered summaries.

## Transcript Formatting Enhancement (v2.2.4)

### Advanced Sentence-Based Segmentation
The project now features intelligent transcript formatting that creates natural, readable segments:

#### Key Features:
- **Sentence Boundaries**: Uses punctuation detection (`.!?`) to identify natural sentence endings
- **Natural Pause Detection**: Configurable threshold (0.8s default) for detecting speech gaps
- **Length Management**: Maximum words per segment (50 default) prevents overly long segments
- **Text Cleaning**: Normalizes whitespace and trims words for clean output
- **Speaker Preservation**: Maintains speaker identification throughout segments

#### Configuration:
```yaml
processing:
  sentence_pause_threshold: 0.8  # seconds - gap between words to split segments
  max_words_per_segment: 50      # maximum words per segment
```

### Implementation Details

#### Core Logic (scribeAPI.mjs):
- `formatScribeResult()`: Enhanced with text cleaning and sentence segmentation
- `createSentenceSegments()`: Main segmentation logic with configurable thresholds
- Text processing: `rawText.replace(/\s+/g, ' ').trim()` for consistent spacing

#### Segmentation Rules:
1. Split on punctuation (`.!?`) at word endings
2. Split on natural pauses exceeding threshold
3. Split when segment exceeds max word count
4. Always split at transcript end

#### Speaker Handling:
- Extracts numeric IDs from "speaker_0" format
- Formats as "Speaker 0", "Speaker 1", etc.
- Preserves speaker identity through segment boundaries

### Benefits for AI Processing:
- More natural reading flow improves Claude's comprehension
- Consistent formatting aids pattern recognition
- Cleaner text reduces parsing overhead
- Proper sentence boundaries improve summarization quality

## Development Notes

### When working on transcription features:
- Test with various audio qualities and speaker counts
- Verify configuration loading with `getConfigValue()`
- Ensure backward compatibility with existing transcripts
- Maintain speaker diarization accuracy

### Code Patterns:
- Use configurable thresholds via `getConfigValue(config, 'path', default)`
- Preserve existing API compatibility
- Include verbose mode support for debugging
- Clean text before processing: whitespace normalization and trimming

### Testing:
- Verify sentence boundary detection with various punctuation
- Test pause threshold with different speaking styles
- Confirm segment length limits work as expected
- Validate speaker identification persistence