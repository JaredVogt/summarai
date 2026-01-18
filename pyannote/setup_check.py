#!/usr/bin/env python3
"""
Quick environment check for Pyannote speaker identification.
Run this script to verify all dependencies are installed correctly.

Usage:
    python3 setup_check.py
    python3 setup_check.py --install  # Install missing dependencies
"""

import sys
import subprocess


def check_python_version():
    """Check Python version is 3.8+."""
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 8):
        return False, f'Python 3.8+ required, found {version.major}.{version.minor}'
    return True, f'Python {version.major}.{version.minor}.{version.micro}'


def check_torch():
    """Check PyTorch installation."""
    try:
        import torch
        cuda_available = torch.cuda.is_available()
        mps_available = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
        device = 'CUDA' if cuda_available else ('MPS' if mps_available else 'CPU')
        return True, f'torch {torch.__version__} ({device})'
    except ImportError:
        return False, 'torch not installed'


def check_pyannote():
    """Check pyannote.audio installation."""
    try:
        import pyannote.audio
        return True, f'pyannote.audio {pyannote.audio.__version__}'
    except ImportError:
        return False, 'pyannote.audio not installed'


def check_scipy():
    """Check scipy installation."""
    try:
        import scipy
        return True, f'scipy {scipy.__version__}'
    except ImportError:
        return False, 'scipy not installed'


def check_numpy():
    """Check numpy installation."""
    try:
        import numpy
        return True, f'numpy {numpy.__version__}'
    except ImportError:
        return False, 'numpy not installed'


def check_huggingface_token():
    """Check if HuggingFace token is configured."""
    import os
    token = os.environ.get('HUGGINGFACE_TOKEN')
    if token:
        return True, 'HUGGINGFACE_TOKEN is set'
    return False, 'HUGGINGFACE_TOKEN not set (required for pyannote models)'


def install_dependencies():
    """Install missing dependencies using pip."""
    print('\nInstalling dependencies...\n')
    try:
        subprocess.check_call([
            sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'
        ])
        print('\nDependencies installed successfully!')
        return True
    except subprocess.CalledProcessError as e:
        print(f'\nFailed to install dependencies: {e}')
        return False


def main():
    """Run all checks and display results."""
    print('=' * 60)
    print('Pyannote Speaker Identification - Environment Check')
    print('=' * 60)
    print()

    checks = [
        ('Python Version', check_python_version),
        ('PyTorch', check_torch),
        ('Pyannote Audio', check_pyannote),
        ('NumPy', check_numpy),
        ('SciPy', check_scipy),
        ('HuggingFace Token', check_huggingface_token),
    ]

    all_passed = True
    results = []

    for name, check_fn in checks:
        passed, message = check_fn()
        status = 'OK' if passed else 'MISSING'
        results.append((name, passed, message))
        if not passed:
            all_passed = False
        print(f'  [{status:7}] {name}: {message}')

    print()
    print('=' * 60)

    if all_passed:
        print('All checks passed! Ready to use speaker identification.')
        print()
        print('To enroll a speaker:')
        print('  summarai speaker enroll "Name" /path/to/audio.wav')
        return 0
    else:
        print('Some checks failed.')
        print()

        # Check if --install flag was passed
        if '--install' in sys.argv:
            if install_dependencies():
                print('\nRe-running checks...\n')
                return main()
        else:
            print('To install missing dependencies:')
            print('  cd pyannote && pip install -r requirements.txt')
            print()
            print('Or run:')
            print('  python3 setup_check.py --install')

        if not results[5][1]:  # HuggingFace token check
            print()
            print('To configure HuggingFace token:')
            print('  1. Create account at https://huggingface.co')
            print('  2. Accept pyannote/embedding model terms at:')
            print('     https://huggingface.co/pyannote/embedding')
            print('  3. Create token at https://huggingface.co/settings/tokens')
            print('  4. Set environment variable:')
            print('     export HUGGINGFACE_TOKEN=hf_your_token_here')

        return 1


if __name__ == '__main__':
    sys.exit(main())
