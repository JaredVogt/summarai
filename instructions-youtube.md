# Instructions for Anthropic Claude - YouTube Video Processing

The content being sent is the transcript of a YouTube video. Follow the instructions below to process it.

## Output Format (Required First 4 Lines)

- Line 1: "Summary: [Create a summary of no more than 6 words]" (used as filename)
- Line 2: "Keywords: [comma-separated keywords including 'YouTube']"
- Line 3: "Participants: [Speaker names from diarization, or 'Speaker 0', 'Speaker 1', etc.]"
- Line 4: "Date: [today's date or upload date if known]"

## Video Context

{{#if videoTitle}}
- **Video Title**: {{videoTitle}}
{{/if}}
{{#if videoDuration}}
- **Duration**: {{videoDuration}}
{{/if}}
{{#if videoUrl}}
- **URL**: {{videoUrl}}
{{/if}}
{{#if uploader}}
- **Channel/Uploader**: {{uploader}}
{{/if}}

## Processing Instructions

1. **Use the provided nomenclature** to interpret technical jargon, product names, or abbreviations accurately.

2. **Primary Transcript**: The main transcript comes from ElevenLabs Scribe with speaker diarization. This is the most accurate source.

3. **Reference Transcript** (if provided): A secondary transcript from YouTube's auto-captions may be included for cross-reference. Use it to clarify unclear words but prefer the primary transcript.

4. **Provide a detailed bullet-point summary** of the main ideas and technical content:
   - Key points and arguments made
   - Notable quotes or statements
   - Technical details or demonstrations
   - Any data, statistics, or examples mentioned

5. **Identify and list action items** if the video contains:
   - Recommendations or advice
   - Steps to follow
   - Resources mentioned (links, tools, books)
   - Calls-to-action from the presenter

6. **Handle multi-topic content**: If the video covers multiple unrelated topics, separate them into distinct sections with their own summaries.

7. **Keywords should include**:
   - Main topics discussed
   - Technologies, products, or tools mentioned
   - People or organizations referenced
   - Always include "YouTube" as a keyword

## Output Format

Format your output in markdown with clear section headers:

```markdown
Summary: [6-word summary]
Keywords: [YouTube, topic1, topic2, ...]
Participants: [Speaker names or generic labels]
Date: [YYYY-MM-DD]

## In-depth Summarization

### [Topic 1]
- Key point 1
- Key point 2

### [Topic 2] (if multiple topics)
- Key point 1
- Key point 2

## Notable Quotes
> "Exact quote from the video" - Speaker

## Action Items / Recommendations
- [ ] Action item 1
- [ ] Action item 2

## Resources Mentioned
- Resource 1 (if any URLs or tools mentioned)
```

## Special Considerations

- Do not include generic phrases like "YouTube Video Summary" in the summary line
- If the video is educational, focus on the learning objectives and key takeaways
- If the video is a discussion/interview, capture the main viewpoints of each participant
- If the video is a tutorial, list the steps in order
- Timestamps in the transcript can help identify important sections - note significant timestamp jumps that may indicate topic changes
