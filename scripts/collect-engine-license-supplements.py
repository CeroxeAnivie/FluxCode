"""Collect pinned repository license files omitted by engine crate archives."""
import argparse
from pathlib import Path
import concurrent.futures
import hashlib
import json
import re
import subprocess
import urllib.error
import urllib.request

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--metadata', type=Path, required=True)
parser.add_argument('--missing', type=Path, required=True)
args = parser.parse_args()
metadata = json.loads(args.metadata.read_text(encoding='utf-8'))
missing = json.loads(args.missing.read_text(encoding='utf-8'))
lookup = {(p['name'], p['version']): p for p in metadata['packages']}
groups = {}
unresolved = []
for package in missing:
    p = lookup[(package['name'], package['version'])]
    directory = Path(p['manifest_path']).parent
    source = p.get('source') or ''
    if source.startswith('git+'):
        git_root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=directory, text=True, encoding='utf-8').strip())
        files = [f for f in git_root.iterdir() if f.is_file() and re.match(r'^(license|licence|copying|notice|copyright)', f.name, re.I)]
        if files:
            groups.setdefault(('local', str(git_root)), {'packages': [], 'files': files})['packages'].append(package)
            continue
    vcs_file = directory / '.cargo_vcs_info.json'
    repository = p.get('repository') or {'pagable_derive':'https://github.com/facebook/starlark-rust', 'zune-core':'https://github.com/etemesi254/zune-image'}.get(p['name'], '')
    match = re.match(r'https://github.com/([^/]+/[^/#]+)', repository)
    if not match:
        unresolved.append(package)
        continue
    vcs = json.loads(vcs_file.read_text(encoding='utf-8')) if vcs_file.exists() else {'git': {'sha1': None}}
    repo = match[1].removesuffix('.git')
    revision = vcs['git']['sha1']
    group = groups.setdefault((repo, revision), {'packages': [], 'paths': set()})
    group['packages'].append(package)
    group['paths'].add(vcs.get('path_in_vcs', ''))

cache = root / 'work/engine-license-cache'
cache.mkdir(exist_ok=True)

def fetch(url):
    name = cache / (hashlib.sha256(url.encode()).hexdigest() + '.txt')
    if name.exists():
        return name.read_text(encoding='utf-8')
    request = urllib.request.Request(url, headers={'User-Agent': 'FluxCode-license-review'})
    with urllib.request.urlopen(request, timeout=15) as response:
        text = response.read(2 * 1024 * 1024).decode('utf-8-sig')
    name.write_text(text, encoding='utf-8', newline='\n')
    return text

def collect(entry):
    (repo, revision), group = entry
    found = []
    if repo == 'local':
        for f in group['files']:
            found.append({'source': f.name, 'text': f.read_text(encoding='utf-8-sig')})
    else:
        # List the pinned repository root once; fetch only upstream license files.
        try:
            if revision is None:
                revision = json.loads(fetch(f'https://api.github.com/repos/{repo}/commits/HEAD'))['sha']
            tree = json.loads(fetch(f'https://api.github.com/repos/{repo}/git/trees/{revision}'))
            names = [p['path'] for p in tree['tree'] if p['type']=='blob' and re.match(r'^(licen[cs]e|copying|notice|copyright)', p['path'], re.I)]
            if not names:
                recursive = json.loads(fetch(f'https://api.github.com/repos/{repo}/git/trees/{revision}?recursive=1'))
                names = [p['path'] for p in recursive['tree'] if p['type']=='blob' and (re.search(r'(^|/)(licen[cs]e[^/]*|copying[^/]*|notice[^/]*)$', p['path'], re.I) or re.match(r'^LICENSES/[^/]+\.txt$', p['path']))][:12]
            if not names:
                # Some releases contain only SPDX/source headers. Preserve their
                # pinned README verbatim as evidence rather than inventing terms.
                for path in ['README.md', 'Readme.md']:
                    if any(p['path']==path for p in tree['tree']):
                        names = [path]
                        break
            for name in names:
                url = f'https://raw.githubusercontent.com/{repo}/{revision}/{name}'
                found.append({'source': url, 'text': fetch(url)})
        except Exception as error:
            return group['packages'], [], type(error).__name__
    return group['packages'], found, None

sections = ['Embedded engine upstream license supplements\nPinned repository revisions where crate archives omit standalone license files.\n']
records = []
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for packages, files, error in pool.map(collect, groups.items()):
        if not files:
            unresolved.extend(packages)
            continue
        label = ', '.join(p['name'] + ' ' + p['version'] for p in packages)
        sections.append('\n' + '=' * 72 + '\n' + label)
        for f in files:
            sections.append('Source: ' + f['source'] + '\n' + f['text'])
            records.append({'packages': [p['name'] for p in packages], 'source': f['source'], 'sha256': hashlib.sha256(f['text'].encode('utf-8')).hexdigest(), 'evidenceKind': 'upstream_readme_only' if f['source'].lower().endswith('/readme.md') else 'license_or_notice'})
(root / 'src-tauri/resources/legal/ENGINE-LICENSE-SUPPLEMENTS.txt').write_text('\n\n'.join(sections) + '\n', encoding='utf-8', newline='\n')
(root / 'work/engine-license-unresolved.json').write_text(json.dumps(unresolved, indent=2), encoding='utf-8')
(root / 'docs/engine-license-provenance.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8', newline='\n')
readme_only = sorted({name for record in records if record['evidenceKind'] == 'upstream_readme_only' for name in record['packages']})
print(json.dumps({'groups': len(groups), 'files': len(records), 'missingEvidence': [p['name'] for p in unresolved], 'standardTermsRequired': readme_only}))
if unresolved:
    raise RuntimeError('Missing upstream license evidence; inspect work/engine-license-unresolved.json')
