"""Paper provenance, declared workflows, immutable manifests and result matrices."""
import hashlib
import re
from urllib.parse import parse_qs, quote, unquote, urlsplit, urlunsplit

from .evaluation_report import metric_key
from .report_common import canonical, clip, find, group, lines, matches, source, unique


def paper_source(raw):
    value = re.sub(r'[.,;]+$', '', raw.strip())
    doi = group(r'^doi:\s*(10\.\d{4,9}/[\w./:;()_-]+)$', value, re.I)
    if doi:
        return dict(id='doi:' + doi.lower(), provider='DOI', url='https://doi.org/' + doi)
    try:
        url = urlsplit(re.sub(r'[)>]+$', '', value))
        if not url.scheme or not url.hostname:
            return None
        host = re.sub(r'^www\.', '', url.hostname.lower())
    except ValueError:
        return None
    if host == 'arxiv.org':
        identifier = group(r'^/(?:abs|pdf)/([\w.-]+/\d{7}|\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?$', url.path, re.I)
        return dict(id='arxiv:' + identifier.lower(), provider='arXiv', url='https://arxiv.org/abs/' + identifier) if identifier else None
    if host == 'openreview.net':
        identifier = parse_qs(url.query).get('id', [None])[0]
        return dict(id='openreview:' + identifier, provider='OpenReview', url='https://openreview.net/forum?id=' + quote(identifier, safe="~()*!.'-")) if identifier else None
    if host == 'doi.org' and find(r'^/10\.\d{4,9}/', url.path, re.I):
        identifier = unquote(url.path[1:])
        return dict(id='doi:' + identifier.lower(), provider='DOI', url='https://doi.org/' + identifier)
    providers = {'aclanthology.org': 'ACL Anthology', 'proceedings.mlr.press': 'PMLR', 'papers.nips.cc': 'NeurIPS',
                 'dl.acm.org': 'ACM Digital Library', 'ieeexplore.ieee.org': 'IEEE Xplore'}
    if host not in providers:
        return None
    path = url.path or '/'
    search = '?' + url.query if url.query else ''
    return dict(id=f'{host}:{path}{search}', provider=providers[host], url=urlunsplit((url.scheme, url.netloc.lower(), path, url.query, '')))


def provenance(readme, text, draft):
    sources, seen = [], set()

    def add(raw, label, line, content):
        normalized = paper_source(raw)
        if not normalized or normalized['id'] in seen or len(sources) >= 12:
            return
        seen.add(normalized['id'])
        label = clip(re.sub(r'[*_`]', '', label or '').strip(), 200) or normalized['provider']
        sources.append(dict(normalized, kind='link', label=label, evidence=source(readme, line, content)))

    readme_lines = lines(text)
    for index, line in enumerate(readme_lines):
        for item in matches(r'\[([^\]]{1,240})\]\((https?://[^\s)]+)\)', line, re.I):
            if item.start() and line[item.start() - 1] == '!':
                continue
            add(item[2], item[1], index + 1, line)
        for item in matches(r'''https?://[^\s<>"']+''', line, re.I):
            add(item[0], None, index + 1, line)
        for item in matches(r'\bdoi\s*:\s*(10\.\d{4,9}/[\w./:;()_-]+)', line, re.I):
            add('doi:' + item[1], None, index + 1, line)

    def declare(title, line, content):
        label = clip(re.sub(r',\s+[A-Z][\w.-]+(?:\s+[A-Z][\w.-]+)+.*$', '', re.sub(r'[*_`]', '', title).strip(), flags=re.ASCII), 200)
        if len(label.encode('utf-16-le', errors='surrogatepass')) // 2 < 8 or any(item['label'].lower() == label.lower() for item in sources):
            return
        identifier = 'readme:' + clip(metric_key(label), 100)
        if identifier in seen or len(sources) >= 12:
            return
        seen.add(identifier)
        sources.append(dict(id=identifier, provider='README paper declaration', kind='declaration', url=None, label=label, evidence=source(readme, line, content)))

    for item in matches(r'(?:official\s+code|implementation)\s+for\s+\*{0,2}[“"]([\s\S]{8,300}?)[”"]\*{0,2}', text, re.I):
        declare(re.sub(r'\s+', ' ', item[1]), len(lines(text[:item.start()])), item[0])
    for index, line in enumerate(readme_lines):
        if find(r'code\s+to\s+accompany\s+(?:the\s+)?paper\s*:?\s*$', line, re.I):
            next_index = next((i for i in range(index + 1, len(readme_lines)) if readme_lines[i].strip() and not find(r'^#+\s', readme_lines[i])), None)
            if next_index is not None:
                declare(readme_lines[next_index], next_index + 1, readme_lines[next_index])
    hints, section = [], ''
    for index, line in enumerate(readme_lines):
        section = group(r'^\s*#{1,6}\s+(.+?)\s*$', line) or section
        command = re.sub(r'\s+#.*$', '', re.sub(r'^[$>]\s*', '', line.strip())).strip()
        role = None
        if find(r'install|setup|prereq|dependenc', section, re.I) and find(r'^make\s+(?:setup|dependency|install)\b', command, re.I):
            role = 'setup'
        elif find(r'data|prepare', section, re.I) and find(r'^make\s+(?:data[\w-]*|prepare[\w-]*)\b', command, re.I):
            role = 'prepare'
        elif find(r'reproduc|reported|results?|table', section, re.I):
            if find(r'^make\s+test\b', command, re.I):
                role = 'preflight'
            elif find(r'^make\s+verify\b', command, re.I):
                role = 'verify'
            elif find(r'^(?:make\s+run[\w-]*\b|(?:\./?venv/bin/)?python3?\s+\S+\.py\b)', command, re.I):
                role = 'experiment'
        if role and not command.endswith('\\') and len(hints) < 16:
            hints.append(dict(id=f'paper-workflow-{index + 1}', role=role, command=command, evidence=source(readme, index + 1, line)))
    suggestion = draft.get('suggestion')
    entry = next((entry for entry in draft['entries'] if suggestion and entry['id'] == suggestion['entryId']), None)
    contexts = [context for context in draft['contexts'] if entry and entry['id'] in context['entryIds']]
    gaps = []
    if not sources:
        gaps.append('paper source')
    elif len(sources) > 1:
        gaps.append('paper source selection')
    if not suggestion:
        if not draft['entries']:
            gaps.append('supported adapter for documented paper workflow' if hints else 'evaluation entry')
        if not draft['outputs']:
            gaps.append('labelled or file metric output')
        if not draft['references']:
            gaps.append('exact README reference metric')
        if draft['entries'] and draft['outputs'] and draft['references']:
            gaps.append('unambiguous command/output/reference association')
    else:
        if not any(item['kind'] in ('dataset', 'split') for item in contexts):
            gaps.append('dataset/split evidence')
        if not any(item['kind'] == 'model' for item in contexts):
            gaps.append('model/checkpoint evidence')
    candidate = dict(sourceId=sources[0]['id'], **suggestion) if len(sources) == 1 and suggestion else None
    return dict(status=('NEEDS_WORK' if gaps else 'READY_FOR_REVIEW') if candidate else 'SOURCE_FOUND' if sources else 'NOT_FOUND',
                sources=sources, workflowHints=hints, candidate=candidate, gaps=gaps)


def paper_workflow(provenance, makefile, text, file_paths):
    hints = []
    for hint in provenance['workflowHints']:
        target = group(r'^make\s+([\w.-]+)$', hint['command'])
        script = group(r'^(?:\./?venv/bin/)?python3?\s+([\w./-]+\.py)(?:\s+--[\w-]+(?:=[\w./:+-]+)?)*$', hint['command'])
        if target:
            declaration = find(rf'^{re.escape(target)}\s*:', text, re.M) if makefile else None
            validation = source(makefile, len(lines(text[:declaration.start()])), target + ':') if declaration else dict(file=makefile or 'Makefile', text='Target not found')
            hints.append(dict(hint, kind='make', target=target, supported=bool(declaration), validation=validation))
        elif script:
            hints.append(dict(hint, kind='python', script=script, supported=script in file_paths,
                              validation=dict(file=script, text='Script found' if script in file_paths else 'Script not found')))
        else:
            hints.append(dict(hint, kind='unsupported', supported=False, validation=dict(text='Only simple Make targets and Python scripts are supported')))
    prerequisites = [hint for hint in hints if hint['role'] in ('setup', 'prepare')]
    test = next((hint for hint in hints if hint['role'] == 'preflight'), None)
    verify = next((hint for hint in hints if hint['role'] == 'verify'), None)
    runs = [hint for hint in hints if hint['role'] == 'experiment']
    adapters = []
    for index, run in enumerate(runs):
        steps = [dict(id=f"{hint['role']}-{hint['id']}", role=hint['role'], command=hint['command'], evidence=hint['evidence'],
                      validation=hint['validation'], supported=hint['supported']) for hint in [*prerequisites, test, run, verify] if hint]
        gaps = ([] if test else ['preflight command']) + ([] if verify else ['verification command']) + [f"validated {step['role']} command" for step in steps if not step['supported']]
        adapters.append(dict(id=f'paper-adapter-{index + 1}', title=f"Paper workflow · {run['command']}", status='BLOCKED' if gaps else 'NEEDS_REVIEW', reviewRequired=True, steps=steps, gaps=gaps))
    return dict(status='NEEDS_REVIEW' if any(item['status'] == 'NEEDS_REVIEW' for item in adapters) else 'BLOCKED' if adapters else 'NOT_FOUND',
                makefile=makefile or None, commands=hints, adapters=adapters, warnings=[
                    'README commands and Make targets are untrusted code and require explicit review before container execution.',
                    'A valid target proves only that the command exists, not that its data, model or paper protocol is correct.'])


def protocol_lock(report, readme, makefile, lock):
    blobs = {entry['path']: entry for entry in lock['treeEntries'] if entry['type'] == 'blob'}
    paths = [readme, makefile, lock['dependencyFile'], lock['pythonVersionFile']]
    paths += [ref['path'] for entry in report['entrypoints'] for ref in entry['references'] if ref['exists']]
    paths += [path for item in report['evaluationDraft']['paths'] for path in item['matches']]

    def blob_identity(path):
        blob = blobs[path]
        return dict(path=path, **({'gitBlobSha': blob['sha']} if 'sha' in blob else {}), **({'size': blob['size']} if 'size' in blob else {}))

    source_files = [blob_identity(path) for path in sorted(set(path for path in paths if path), key=lambda value: value.encode('utf-16-be', errors='surrogatepass')) if path in blobs]
    assets = [dict(kind=item['kind'], declaredPath=item['path'], evidence=item['evidence'],
                   matches=[blob_identity(path) if path in blobs else {'path': path} for path in item['matches']],
                   status='PINNED_TO_COMMIT' if item['matches'] else 'ROLE_UNRESOLVED' if item['kind'] == 'data-or-output' else 'MISSING_OR_EXTERNAL') for item in report['evaluationDraft']['paths']]
    dependencies, python = lock['dependencyVersions'], lock['pythonVersionResult']
    locked = bool(dependencies and (dependencies['lockFile'] or dependencies['verifiable'] and dependencies['total'] > 0 and not dependencies['unpinned']))
    adapters = [item for item in report['paperWorkflowDraft']['adapters'] if item['status'] == 'NEEDS_REVIEW']
    gaps = []
    if len(report['paperProvenance']['sources']) != 1:
        gaps.append('one selected paper source')
    if not adapters:
        gaps.append('source-validated paper workflow adapter')
    if not python or not python['exact']:
        gaps.append('exact Python version')
    if not locked:
        gaps.append('locked or exactly pinned dependencies')
    if any(item['status'] == 'MISSING_OR_EXTERNAL' for item in assets):
        gaps.append('missing/external config or checkpoint assets')
    if any(item['status'] == 'ROLE_UNRESOLVED' for item in assets):
        gaps.append('data/output path role review')
    if adapters and not lock['seedConfiguration']:
        gaps.append('random seed evidence or an explicit deterministic-protocol review')
    manifest = dict(schemaVersion=1, repository=report['repository'], commit=report['commit'], paperSources=report['paperProvenance']['sources'],
        claims=[{key: item.get(key) for key in ('id', 'metricKey', 'label', 'value', 'precision', 'unit', 'evidence')} for item in report['evaluationDraft']['references']],
        adapters=adapters, environment=dict(python=python, pythonFile=lock['pythonVersionFile'], dependencies=dependencies, dependencyFile=lock['dependencyFile'], dependencyLocked=locked),
        sourceFiles=source_files, declaredAssets=assets, seedEvidence=lock['seedConfiguration'], parameters=report['experimentParameters'])
    return dict(manifest, lockId=hashlib.sha256(canonical(manifest).encode('utf-8')).hexdigest(), status='INCOMPLETE' if gaps else 'READY_FOR_REVIEW', gaps=gaps,
        warnings=['Git blob hashes pin repository files to the scanned commit; runtime downloads still need independent SHA-256 identities.',
                  'A protocol lock records declared evidence and does not prove that the paper protocol is scientifically equivalent.'])


def paper_matrix(report):
    cells = []
    for ref in report['evaluationDraft']['references']:
        parts = [part.strip() for part in ref['label'].split(' · ') if part.strip()]
        if len(parts) < 3:
            continue
        seed_part = next((part for part in parts if find(r'^seed\s*[=:]', part, re.I)), None)
        seed = re.split(r'[=:]', seed_part)[1].strip() or None if seed_part else None
        dimensions = [part for part in parts[:-1] if part != seed_part]
        if len(dimensions) < 2:
            continue
        dataset, model = dimensions[:2]
        cells.append(dict(id='matrix-' + ref['id'], referenceId=ref['id'], dataset=dataset, model=model, seed=seed,
            column=f'{model}[seed={seed}]' if seed else model, metricKey=ref['metricKey'], metricLabel=parts[-1],
            target=ref['value'], precision=ref.get('precision'), unit=ref['unit'], evidence=ref['evidence']))
    adapters = [item for item in report['paperWorkflowDraft']['adapters'] if item['status'] == 'NEEDS_REVIEW']
    gaps = ([] if cells else ['contextual paper result table with dataset and model labels']) + ([] if adapters else ['source-validated paper workflow adapter'])
    if not report.get('protocolLock'):
        gaps.append('protocol lock')
    return dict(status=('BLOCKED' if cells else 'NOT_FOUND') if gaps else 'NEEDS_REVIEW', cells=cells, adapters=adapters,
        axes=dict(datasets=unique(cell['dataset'] for cell in cells), models=unique(cell['model'] for cell in cells),
                  seeds=unique(cell['seed'] for cell in cells if cell['seed']), metrics=unique(cell['metricKey'] for cell in cells)),
        gaps=gaps, warnings=['Matrix labels are parsed from README tables; review dataset/model columns and output CSV headers before execution.',
                             'Retry reruns the complete source workflow in a fresh container; cross-container checkpoint resume is not inferred.'])
