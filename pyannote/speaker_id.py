#!/usr/bin/env python3
"""
Speaker identification using Pyannote embeddings.
Communicates with Node.js via JSON stdin/stdout.

Actions:
  - check: Verify Python environment and dependencies
  - enroll: Create a voice profile from audio sample
  - identify: Match speakers in transcript segments to enrolled profiles
  - list: List all enrolled speaker profiles
  - delete: Remove a speaker profile
"""

import sys
import json
import os
from pathlib import Path


def check_dependencies():
    """Check if required dependencies are installed."""
    missing = []

    try:
        import torch
    except ImportError:
        missing.append('torch')

    try:
        import numpy
    except ImportError:
        missing.append('numpy')

    try:
        import scipy
    except ImportError:
        missing.append('scipy')

    try:
        from pyannote.audio import Inference
    except ImportError:
        missing.append('pyannote.audio')

    return missing


def output_json(data):
    """Output JSON to stdout and exit."""
    print(json.dumps(data))
    sys.stdout.flush()


def output_error(message, error_type='error'):
    """Output error response."""
    output_json({
        'success': False,
        'error': message,
        'error_type': error_type
    })
    sys.exit(1)


def expand_path(path_str):
    """Expand ~ and environment variables in path."""
    return Path(os.path.expandvars(os.path.expanduser(path_str)))


def action_check(data):
    """Check Python environment and dependencies."""
    missing = check_dependencies()

    if missing:
        output_json({
            'success': False,
            'error': f'Missing dependencies: {", ".join(missing)}',
            'error_type': 'missing_dependencies',
            'missing': missing
        })
    else:
        # Try to verify HuggingFace token if provided
        hf_token = data.get('huggingface_token') or os.environ.get('HUGGINGFACE_TOKEN')
        token_status = 'provided' if hf_token else 'missing'

        output_json({
            'success': True,
            'python_version': sys.version,
            'huggingface_token_status': token_status
        })


def get_model(hf_token=None):
    """Load the Pyannote embedding model."""
    from pyannote.audio import Inference

    token = hf_token or os.environ.get('HUGGINGFACE_TOKEN')
    if not token:
        raise ValueError('HuggingFace token required. Set HUGGINGFACE_TOKEN environment variable.')

    # Use the speaker embedding model
    model = Inference('pyannote/embedding', window='whole', use_auth_token=token)
    return model


def extract_embedding(model, audio_path, start=None, end=None):
    """Extract embedding from audio file or segment."""
    import numpy as np

    audio_path = str(audio_path)

    if start is not None and end is not None:
        # Extract embedding from specific segment
        # Pyannote can handle file + segment specification
        from pyannote.core import Segment
        segment = Segment(start, end)
        embedding = model.crop(audio_path, segment)
    else:
        # Extract embedding from entire file
        embedding = model(audio_path)

    return np.array(embedding)


def cosine_similarity(a, b):
    """Calculate cosine similarity between two embeddings."""
    import numpy as np
    from scipy.spatial.distance import cosine

    a = np.array(a).flatten()
    b = np.array(b).flatten()

    # cosine() returns distance, so similarity = 1 - distance
    return 1 - cosine(a, b)


def action_enroll(data):
    """Enroll a new speaker profile."""
    import numpy as np
    from datetime import datetime

    name = data.get('name')
    audio_path = data.get('audio_path')
    profiles_dir = expand_path(data.get('profiles_dir', '~/.summarai/profiles'))
    hf_token = data.get('huggingface_token')

    if not name:
        output_error('Name is required for enrollment', 'validation_error')

    if not audio_path:
        output_error('Audio path is required for enrollment', 'validation_error')

    audio_path = expand_path(audio_path)
    if not audio_path.exists():
        output_error(f'Audio file not found: {audio_path}', 'file_not_found')

    # Create profiles directory if needed
    profiles_dir.mkdir(parents=True, exist_ok=True)

    # Create profile directory (sanitize name for filesystem)
    profile_id = name.lower().replace(' ', '_')
    profile_id = ''.join(c for c in profile_id if c.isalnum() or c == '_')
    profile_path = profiles_dir / profile_id

    if profile_path.exists():
        output_error(f'Profile "{name}" already exists', 'profile_exists')

    profile_path.mkdir(parents=True, exist_ok=True)

    try:
        # Load model and extract embedding
        model = get_model(hf_token)
        embedding = extract_embedding(model, audio_path)

        # Save embedding
        np.save(profile_path / 'embedding.npy', embedding)

        # Get audio duration for metadata
        try:
            from pyannote.audio import Audio
            audio = Audio()
            waveform, sample_rate = audio(str(audio_path))
            duration = waveform.shape[1] / sample_rate
        except Exception:
            duration = None

        # Save metadata
        metadata = {
            'name': name,
            'display_name': name,
            'profile_id': profile_id,
            'created_at': datetime.utcnow().isoformat() + 'Z',
            'sample_duration_seconds': duration,
            'embedding_version': 'pyannote/embedding@3.1',
            'source_file': str(audio_path)
        }

        with open(profile_path / 'metadata.json', 'w') as f:
            json.dump(metadata, f, indent=2)

        # Update index
        update_profile_index(profiles_dir)

        output_json({
            'success': True,
            'profile_id': profile_id,
            'name': name,
            'profile_path': str(profile_path),
            'sample_duration_seconds': duration
        })

    except Exception as e:
        # Clean up on failure
        if profile_path.exists():
            import shutil
            shutil.rmtree(profile_path, ignore_errors=True)
        output_error(f'Enrollment failed: {str(e)}', 'enrollment_error')


def update_profile_index(profiles_dir):
    """Update the profile index file."""
    profiles_dir = Path(profiles_dir)
    index = {
        'version': '1.0',
        'profiles': []
    }

    for profile_path in profiles_dir.iterdir():
        if profile_path.is_dir():
            metadata_file = profile_path / 'metadata.json'
            if metadata_file.exists():
                with open(metadata_file) as f:
                    metadata = json.load(f)
                index['profiles'].append({
                    'id': metadata.get('profile_id', profile_path.name),
                    'display_name': metadata.get('display_name', metadata.get('name')),
                    'path': profile_path.name + '/',
                    'created_at': metadata.get('created_at')
                })

    with open(profiles_dir / 'index.json', 'w') as f:
        json.dump(index, f, indent=2)


def load_profiles(profiles_dir):
    """Load all enrolled profiles with their embeddings."""
    import numpy as np

    profiles_dir = Path(profiles_dir)
    profiles = {}

    if not profiles_dir.exists():
        return profiles

    for profile_path in profiles_dir.iterdir():
        if profile_path.is_dir():
            embedding_file = profile_path / 'embedding.npy'
            metadata_file = profile_path / 'metadata.json'

            if embedding_file.exists() and metadata_file.exists():
                try:
                    embedding = np.load(embedding_file)
                    with open(metadata_file) as f:
                        metadata = json.load(f)

                    profiles[profile_path.name] = {
                        'embedding': embedding,
                        'display_name': metadata.get('display_name', metadata.get('name')),
                        'metadata': metadata
                    }
                except Exception as e:
                    # Skip corrupted profiles
                    sys.stderr.write(f'Warning: Could not load profile {profile_path.name}: {e}\n')
                    continue

    return profiles


def action_identify(data):
    """Identify speakers in transcript segments."""
    import numpy as np

    audio_path = data.get('audio_path')
    segments = data.get('segments', [])
    profiles_dir = expand_path(data.get('profiles_dir', '~/.summarai/profiles'))
    threshold = data.get('threshold', 0.70)
    hf_token = data.get('huggingface_token')

    if not audio_path:
        output_error('Audio path is required', 'validation_error')

    audio_path = expand_path(audio_path)
    if not audio_path.exists():
        output_error(f'Audio file not found: {audio_path}', 'file_not_found')

    # Load enrolled profiles
    profiles = load_profiles(profiles_dir)

    if not profiles:
        # No profiles enrolled - return empty mapping (will use generic labels)
        output_json({
            'success': True,
            'speaker_mapping': {},
            'confidence_scores': {},
            'message': 'No speaker profiles enrolled'
        })
        return

    try:
        model = get_model(hf_token)
    except Exception as e:
        output_error(f'Failed to load model: {str(e)}', 'model_error')

    # Group segments by speaker_id
    speaker_segments = {}
    for segment in segments:
        speaker_id = segment.get('speaker_id') or segment.get('speaker', '').replace('Speaker ', 'speaker_')
        if speaker_id not in speaker_segments:
            speaker_segments[speaker_id] = []
        speaker_segments[speaker_id].append(segment)

    speaker_mapping = {}
    confidence_scores = {}

    for speaker_id, segs in speaker_segments.items():
        # Get a representative segment for this speaker
        # Use the longest segment or middle segment for better sample
        segs_sorted = sorted(segs, key=lambda s: (s.get('end', 0) - s.get('start', 0)), reverse=True)

        best_match = None
        best_score = 0

        # Try up to 3 segments to get a good match
        for seg in segs_sorted[:3]:
            start = seg.get('start', 0)
            end = seg.get('end', 0)

            # Skip very short segments
            if end - start < 1.0:
                continue

            try:
                # Extract embedding for this segment
                segment_embedding = extract_embedding(model, audio_path, start, end)

                # Compare against all profiles
                for profile_id, profile_data in profiles.items():
                    similarity = cosine_similarity(segment_embedding, profile_data['embedding'])

                    if similarity > best_score:
                        best_score = similarity
                        best_match = profile_data['display_name']

            except Exception as e:
                sys.stderr.write(f'Warning: Failed to process segment {start}-{end}: {e}\n')
                continue

        # Apply match if above threshold
        if best_match and best_score >= threshold:
            speaker_mapping[speaker_id] = best_match
            confidence_scores[speaker_id] = round(best_score, 3)
        else:
            # Keep generic label (null in mapping means no change)
            speaker_mapping[speaker_id] = None
            confidence_scores[speaker_id] = round(best_score, 3) if best_score > 0 else 0

    output_json({
        'success': True,
        'speaker_mapping': speaker_mapping,
        'confidence_scores': confidence_scores
    })


def action_list(data):
    """List all enrolled speaker profiles."""
    profiles_dir = expand_path(data.get('profiles_dir', '~/.summarai/profiles'))

    profiles = []

    if profiles_dir.exists():
        for profile_path in profiles_dir.iterdir():
            if profile_path.is_dir():
                metadata_file = profile_path / 'metadata.json'
                if metadata_file.exists():
                    try:
                        with open(metadata_file) as f:
                            metadata = json.load(f)
                        profiles.append({
                            'id': profile_path.name,
                            'name': metadata.get('name'),
                            'display_name': metadata.get('display_name'),
                            'created_at': metadata.get('created_at'),
                            'sample_duration_seconds': metadata.get('sample_duration_seconds')
                        })
                    except Exception:
                        continue

    output_json({
        'success': True,
        'profiles': profiles,
        'count': len(profiles)
    })


def action_delete(data):
    """Delete a speaker profile."""
    import shutil

    name = data.get('name')
    profiles_dir = expand_path(data.get('profiles_dir', '~/.summarai/profiles'))

    if not name:
        output_error('Name is required for deletion', 'validation_error')

    # Try to find profile by name or id
    profile_id = name.lower().replace(' ', '_')
    profile_id = ''.join(c for c in profile_id if c.isalnum() or c == '_')
    profile_path = profiles_dir / profile_id

    if not profile_path.exists():
        # Try to find by display_name
        found = False
        for p in profiles_dir.iterdir():
            if p.is_dir():
                metadata_file = p / 'metadata.json'
                if metadata_file.exists():
                    try:
                        with open(metadata_file) as f:
                            metadata = json.load(f)
                        if metadata.get('name', '').lower() == name.lower() or \
                           metadata.get('display_name', '').lower() == name.lower():
                            profile_path = p
                            found = True
                            break
                    except Exception:
                        continue

        if not found:
            output_error(f'Profile "{name}" not found', 'profile_not_found')

    try:
        shutil.rmtree(profile_path)
        update_profile_index(profiles_dir)

        output_json({
            'success': True,
            'deleted': name,
            'profile_path': str(profile_path)
        })
    except Exception as e:
        output_error(f'Failed to delete profile: {str(e)}', 'delete_error')


def main():
    """Main entry point - read JSON from stdin, execute action, output JSON."""
    try:
        # Read input from stdin
        input_data = sys.stdin.read()

        if not input_data.strip():
            output_error('No input data provided', 'input_error')

        data = json.loads(input_data)
        action = data.get('action', 'check')

        # Route to appropriate action handler
        actions = {
            'check': action_check,
            'enroll': action_enroll,
            'identify': action_identify,
            'list': action_list,
            'delete': action_delete
        }

        handler = actions.get(action)
        if not handler:
            output_error(f'Unknown action: {action}', 'unknown_action')

        handler(data)

    except json.JSONDecodeError as e:
        output_error(f'Invalid JSON input: {str(e)}', 'json_error')
    except Exception as e:
        output_error(f'Unexpected error: {str(e)}', 'unexpected_error')


if __name__ == '__main__':
    main()
