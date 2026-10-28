"""A single, idempotent sandbox job. Provider output stays in a private log."""
import json
import hashlib
import os
import subprocess
import sys
import tarfile
from pathlib import Path

root = Path('/vercel/sandbox')
job = root / 'job'
job.mkdir(exist_ok=True)
try:
    marker = os.open(job / 'started', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(marker)
except FileExistsError:
    raise SystemExit(0)

with (job / 'worker.log').open('w', encoding='utf-8') as log:
    try:
        (job / 'progress.json').write_text(json.dumps({'stage': 'Preparing TradingAgents runtime'}))
        provenance = json.loads((root / 'engine-provenance.json').read_text())
        if hashlib.sha256((root / 'engine.tar').read_bytes()).hexdigest() != provenance['sha256']:
            raise ValueError('Engine archive integrity check failed')
        with tarfile.open(root / 'engine.tar') as archive:
            archive.extractall(root / 'engine', filter='data')
        # Use complete managed CPython: the lightweight runtime omits sqlite3 and ensurepip.
        subprocess.run(['uv', 'venv', '--managed-python', '--python', '3.13', str(root / '.venv')], check=True, stdout=log, stderr=log)
        python = str(root / '.venv/bin/python')
        subprocess.run(['uv', 'pip', 'install', '--python', python, '-r', str(root / 'requirements.lock.txt')], check=True, stdout=log, stderr=log)
        subprocess.run(['uv', 'pip', 'install', '--python', python, '--no-deps', '-e', str(root / 'engine')], check=True, stdout=log, stderr=log)
        subprocess.run([python, str(root / 'runner.py'), str(job)], check=True, stdout=log, stderr=log)
        from reports import coverage_warnings
        report = json.loads((job / 'report.json').read_text())
        warnings = coverage_warnings((job / 'worker.log').read_text(errors='replace'))
        report['coverageWarnings'] = warnings
        report.setdefault('warnings', []).extend(warnings)
        if not report.get('sections', {}).get('decision', {}).get('content'):
            raise ValueError('Incomplete report')
        (job / 'final.json').write_text(json.dumps(report))
        (job / 'done.json').write_text(json.dumps({'success': True}))
    except Exception:
        (job / 'done.json').write_text(json.dumps({'success': False}))
