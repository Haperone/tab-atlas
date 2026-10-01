"""Build and verify a dependency-free Chrome Web Store ZIP from extension/."""
import hashlib
import json
import posixpath
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'extension'
manifest = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Expected a three-part release version'
assert json.loads((ROOT / 'package.json').read_text())['version'] == version
files = {}
for path in sorted(SOURCE.rglob('*')):
    if not path.is_file():
        continue
    relative = path.relative_to(SOURCE)
    if relative.as_posix() == 'config.local.js':
        continue
    if any(part.startswith('.') or part in ('store-assets', 'node_modules', 'tests') for part in relative.parts):
        continue
    assert path.suffix in ('.js', '.css', '.html', '.json', '.png', '.svg', '.wav'), f'Unexpected package file: {relative}'
    files[relative.as_posix()] = path.read_bytes()

def require(reference, owner='manifest.json'):
    if not reference or reference.startswith(('#', 'data:', 'https:', 'http:', 'chrome:', 'chrome-extension:')):
        return
    reference = reference.split('#')[0].split('?')[0]
    target = posixpath.normpath(posixpath.join(posixpath.dirname(owner), reference))
    assert not target.startswith('../') and target in files, f'Missing package dependency: {owner} -> {reference}'

entrypoints = [manifest['background']['service_worker'], manifest['action']['default_popup'],
              *manifest['chrome_url_overrides'].values(), *manifest['icons'].values(),
              *manifest['action']['default_icon'].values(), 'save-sound.html', 'sounds/save.wav', 'sounds/undo.wav']
for name in entrypoints:
    require(name)
dependency_count = 0
for name, data in files.items():
    if name.endswith('.js'):
        subprocess.run(['node', '--check', str(SOURCE / name)], check=True, capture_output=True)
        source = data.decode('utf-8')
        references = re.findall(r'^[ \t]*import\s+(?:[\w*{},\s]+\bfrom\s*)?[\'\"]([^\'\"]+)[\'\"]', source, re.M)
        references += re.findall(r'\bimport\s*\(\s*[\'\"]([^\'\"]+)[\'\"]', source)
    elif name.endswith('.html'):
        references = re.findall(r'<(?:script|link|img)\b[^>]*\b(?:src|href)=[\'\"]([^\'\"]+)', data.decode('utf-8'), re.I)
    elif name.endswith('.css'):
        references = [next(value for value in match if value) for match in
                      re.findall(r'url\(\s*(?:"([^"]*)"|\'([^\']*)\'|([^\'"\)]+))\s*\)', data.decode('utf-8'))]
    else:
        references = []
    for reference in references:
        require(reference, name)
        dependency_count += 1

destination = ROOT / 'release' / f'tab-atlas-{version}-chrome-web-store.zip'
assert not destination.exists(), f'Release already exists: {destination}. Do not overwrite it silently.'
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in files.items():
        info = zipfile.ZipInfo(name, (2026, 9, 30, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data, compresslevel=9)
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None, 'ZIP CRC verification failed'
    assert set(archive.namelist()) == set(files), 'Package inventory mismatch'
    assert json.loads(archive.read('manifest.json'))['version'] == version
    for name, data in files.items():
        assert archive.read(name) == data, f'Package differs from current source: {name}'

report = {
    'version': version, 'archive': destination.name, 'bytes': destination.stat().st_size,
    'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'fileCount': len(files),
    'verified': ['manifest at ZIP root', 'CRC integrity', 'exact source bytes', 'manifest entrypoints',
                 'local JS/HTML/CSS dependencies', 'all packaged JavaScript syntax', 'no development/store assets'],
    'dependencyReferences': dependency_count,
    'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
}
report_path = destination.parent / f'tab-atlas-{version}-package-report.json'
report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'files'}, indent=2))
