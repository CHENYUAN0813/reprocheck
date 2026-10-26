"""Literal source-backed metric/argument candidates; never execute repository code."""
import math
import re

from .report_common import clip, find, group, lines, matches, quote, source

CUTOFF = r'(?:\s*[@_-]?\s*\d+)?'
METRICS = rf'accuracy|acc|precision{CUTOFF}|recall{CUTOFF}|f1(?:[-_ ]score)?{CUTOFF}|ndcg{CUTOFF}|mrr{CUTOFF}|map{CUTOFF}|hit(?:[-_ ]?rate)?{CUTOFF}|auc|mse|mae|rmse|loss|perplexity'
NUMBER = r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?'


def metric_key(label):
    return re.sub(r'^_|_$', '', re.sub(r'[^\w]+', '_', label.lower(), flags=re.ASCII))


def table_metric(label):
    return group(rf'^(?:(?:test|train(?:ing)?|validation|val|software|top[- ]?[15])\s+)?({METRICS})(?:\s*\(%\))?$', re.sub(r'[*`]', '', label), re.I)


def metric_type(label):
    value = group(rf'\b({METRICS})\b', label.replace('_', ' '), re.I)
    if value is None:
        return None
    value = re.sub(r'^acc$', 'accuracy', value.lower())
    value = re.sub(r'^f1(?:[-_ ]score)?', 'f1_score', value)
    # Keep the legacy rule's literal-backslash suffix match for fingerprint parity.
    value = re.sub(r'\\s*[@_-]?\\s*(\\d+)$', r'_\1', value)
    return re.sub(r'[ -]+', '_', value)


def precision(raw):
    parts = raw.lower().split('e')[0].split('.')
    return len(parts[1]) if len(parts) > 1 else 0


def execution_arguments(file):
    result = []
    declarations = list(matches(r'''\.add_argument\(\s*((?:"[^"\n]*"|'[^'\n]*')[\s\S]{0,1200}?)\)\s*''', file['text']))[:24]
    for index, declaration in enumerate(declarations):
        body = declaration[1]
        head = group(r'''^\s*((?:["'][^"']+["']\s*,?\s*)+)''', body) or ''
        names = [item[1] for item in matches(r'''["']([^"']+)["']''', head)]
        name = next((item for item in names if item.startswith('--')), names[0] if names else None)
        if not name or not find(r'^(?:--?)?[\w-]+$', name):
            continue
        positional = not name.startswith('-')
        nargs = group(r'\bnargs\s*=\s*([^,\n]+)', body)
        nargs = re.sub(r'''^["']|["']$''', '', nargs.strip()) if nargs else None
        action = group(r'''\baction\s*=\s*["']([^"']+)["']''', body) or ('dynamic' if find(r'\baction\s*=', body) else 'store')
        default = group(r'''\bdefault\s*=\s*("[^"\n]*"|'[^'\n]*'|[-+]?\d+(?:\.\d+)?|True|False|None)(?=\s*[,\n]|\s*$)''', body)
        default = re.sub(r'''^["']|["']$''', '', default) if default and default != 'None' else None
        result.append(dict(id=f'argument-{index + 1}', name=name, aliases=names, positional=positional,
            required=nargs not in ('?', '*') if positional else bool(find(r'\brequired\s*=\s*True\b', body)),
            default=default, supported=action == 'store' and (not nargs or nargs == '?'),
            help=group(r'''\bhelp\s*=\s*["']([^"']*)["']''', body) or '',
            evidence=source(file['path'], len(lines(file['text'][:declaration.start()])), declaration[0])))
    return result


def arguments_complete(entry):
    """Check the original command only; editing/quoting runtime arguments stays in JS."""
    args = entry.get('arguments', [])
    tokens = [re.sub(r'''^["']|["']$''', '', item[0]) for item in matches(r'''"[^"\n]*"|'[^'\n]*'|[^\s]+''', entry['command'])]
    script = next((index for index, token in enumerate(tokens) if find(r'\.py$', token)), -1)
    if args and (script < 0 or any(find(r'^(?:&&|\|\||[;|<>])$', token) for token in tokens[script + 1:])):
        return False
    tail, positionals, index = tokens[script + 1:], [], 0
    while index < len(tail):
        token = tail[index]
        if token.startswith('-'):
            option = next((arg for arg in args if token.split('=')[0] in arg['aliases']), None)
            if '=' not in token and (not option or option['supported']):
                index += 1
        else:
            positionals.append(token)
        index += 1
    positional_index = 0
    for arg in args:
        if arg['positional']:
            present = positional_index < len(positionals)
            positional_index += 1
        else:
            present = any(token == alias or token.startswith(alias + '=') for token in tail for alias in arg['aliases'])
        if not present and arg['required']:
            return False
    return True


def suggest_candidate(report):
    draft, found = report['evaluationDraft'], []
    for entry in draft['entries']:
        if not arguments_complete(entry):
            continue
        for output in draft['outputs']:
            if entry['id'] not in output['entryIds'] or not output['metricKey']:
                continue
            for reference in draft['references']:
                if reference['entryId'] != entry['id'] or reference['unit'] != output.get('unit') or metric_type(reference['metricKey']) != metric_type(output['metricKey']):
                    continue
                command = re.sub(r'^(?:[-*]\s+)?[$>]\s*', '', entry['command'])
                repo = re.escape(report['repository'].split('/')[-1])
                command = re.sub(rf'^cd\s+(?:\./)?{repo}\s*&&\s*', '', command, flags=re.I)
                if output['kind'] in ('stdout', 'stdout-json') and not find(r'^(?:(?:cd|pushd)\s+\S+\s*&&\s*)?python3?\s', command):
                    continue
                found.append(dict(entryId=entry['id'], outputId=output['id'], referenceId=reference['id'], confirmed=False))
    return found[0] if len(found) == 1 else None


def build_evaluation(readme, text, entrypoints, files, file_paths):
    entries = [entry for entry in entrypoints if entry['category'] not in ('training', 'preprocess', 'demo')
               and not find(r'\bpython3?\s+-m\s+(?:venv|pip|pytest)\b', entry['command'])]
    for file in files:
        if find(r'(?:^|/)(?:eval(?:uate)?|benchmark|main)[\w-]*\.py$', file['path'], re.I) and find(r'__main__|ArgumentParser', file['text']):
            if not any(ref['path'] == file['path'] for entry in entries for ref in entry['references']):
                entries.append(dict(id=f'code-{len(entries) + 1}', category='evaluation', command=f"python {quote(file['path'])}",
                    evidence=source(file['path'], 1, lines(file['text'])[0]), origin='inferred-script',
                    note='Command inferred from script name; review working directory and required arguments',
                    references=[dict(path=file['path'], exists=True)], parameters=[]))
    for entry in entries:
        args = [arg for file in files if any(ref['path'] == file['path'] for ref in entry['references'])
                and find(r'\.py$', file['path'], re.I) for arg in execution_arguments(file)][:24]
        entry['arguments'] = [dict(arg, id=f'argument-{index + 1}') for index, arg in enumerate(args)]
    references, header, context = [], None, None
    readme_lines = lines(text)

    def cells_of(line):
        return [cell.strip() for cell in re.sub(r'^\||\|$', '', line.strip()).split('|')] if '|' in line else None

    for index, line in enumerate(readme_lines):
        if len(references) >= 96:
            break
        cells = cells_of(line)
        context_metric = group(rf'\b({METRICS})\b', line, re.I) if not cells and find(r'\b(?:table|reported|results?|scores?|metrics?)\b', line, re.I) else None
        if context_metric:
            context = dict(metric=context_metric, line=index + 1)
        if cells and len(cells) == 2 and table_metric(cells[0]) and find(r'^[\d.+-]', cells[1]):
            value = find(rf'^({NUMBER})\s*(%)?$', cells[1], re.I)
            if value and math.isfinite(float(value[1])):
                references.append(dict(id=f'reference-{index + 1}-1', metricKey=metric_key(table_metric(cells[0])), label=cells[0],
                    value=float(value[1]), precision=precision(value[1]), unit='percent' if value[2] else 'as printed (no conversion)',
                    entryId=None, evidence=source(readme, index + 1, line), note='Metric/value table candidate; dataset/model correspondence requires review'))
            continue
        next_cells = cells_of(readme_lines[index + 1]) if index + 1 < len(readme_lines) else None
        table_start = cells and next_cells and len(cells) == len(next_cells) and all(find(r'^:?-{3,}:?$', re.sub(r'\s', '', cell)) for cell in next_cells)
        if cells and (any(table_metric(cell) for cell in cells) or (table_start and context and index + 1 - context['line'] <= 4)):
            header = cells
            continue
        if not cells and not context_metric:
            header = None
            if context and index + 1 - context['line'] > 4:
                context = None
        associated = sorted([entry for entry in entries if entry['evidence']['file'] == readme and entry['evidence']['line'] < index + 1
                             and index + 1 - entry['evidence']['line'] <= 24], key=lambda entry: -entry['evidence']['line'])

        def add(label, raw, percent, column, row=None, key=None):
            if len(references) >= 96 or not math.isfinite(float(raw)):
                return
            references.append(dict(id=f'reference-{index + 1}-{column}', metricKey=metric_key(key if key is not None else label), value=float(raw),
                precision=precision(raw), unit='percent' if percent else 'as printed (no conversion)', label=f'{row} · {label}' if row else label,
                entryId=None if row else associated[0]['id'] if associated else None, evidence=source(readme, index + 1, line),
                note='README report/example candidate, not independently verified paper or dataset/model correspondence'))

        if cells and header and len(cells) == len(header):
            for column, label in enumerate(header):
                clean = re.sub(r'[*`]', '', label)
                value = find(rf'^({NUMBER})\s*(%)?$', re.sub(r'[*`]', '', cells[column]), re.I)
                key = table_metric(clean)
                if key and value:
                    add(clean, value[1], value[2] or '(%)' in clean, column, cells[0], key)
                elif column and value and context:
                    add(f"{clean} · {context['metric']}", value[1], value[2], column, cells[0], context['metric'])
        else:
            for value in matches(rf'^[\s*`]*({METRICS})[\s*`]*(?::|=|is)[\s*`]*({NUMBER})\s*(%)?[\s*`]*$', line, re.I):
                add(value[1], value[2], value[3], value.start())
    outputs, contexts, paths = [], [], []
    for file in files:
        ids = [entry['id'] for entry in entries if any(ref['path'] == file['path'] for ref in entry['references'])]
        if not ids:
            continue
        code_lines = lines(file['text'])
        for index, line in enumerate(code_lines):
            evidence = source(file['path'], index + 1, line)
            label = group(rf'''\b(?:print|(?:logging|logger)\.(?:info|warning|debug|error))\(\s*[f]?["']([^"'=:]*\b(?:{METRICS})\b[^"'=:]*?)\s*[:=]''', line, re.I)
            if label is None:
                label = group(rf'''\bprint\(\s*["']([^"']*\b(?:{METRICS})\b[^"']*)["']\s*,''', line, re.I)
            label = re.sub(r'\\[tnr]', ' ', label).strip() if label is not None else None
            if label and len(label.encode('utf-16-le', errors='surrogatepass')) // 2 <= 80:
                outputs.append(dict(id=f'stdout-{len(outputs) + 1}', kind='stdout', label=label, metricKey=metric_key(label),
                    unit='percent' if find(r'%%|\}%|\d%', line) else 'as printed (no conversion)', entryIds=ids, evidence=evidence,
                    note='Captures exactly one complete numeric labelled line; missing/duplicate values fail'))
            if find(r'\bprint\(\s*json\.dumps\(', line):
                for item in matches(rf'''["']({METRICS})["']\s*:''', line, re.I):
                    outputs.append(dict(id=f'stdout-json-{len(outputs) + 1}', kind='stdout-json', metricKey=metric_key(item[1]),
                        unit='as printed (no conversion)', entryIds=ids, evidence=evidence,
                        note='One complete JSON-object metric line required; nested/dynamic keys need manual review'))
            path = group(r'''open\(\s*["']([^"']+\.(?:json|csv))["']\s*,\s*["'][wax]''', line)
            if path is None:
                path = group(r'''\.to_csv\(\s*["']([^"']+\.csv)["']''', line)
            if path is None and find(r'json\.dump|write_text', file['text']):
                path = group(r'''Path\(\s*["']([^"']+\.json)["']\s*\)''', line)
            if path and not find(r'^(?:/|[A-Za-z]:)|(?:^|/)\.\.(?:/|$)', path):
                key = group(rf'''["']({METRICS})["']\s*:''', file['text'], re.I)
                outputs.append(dict(id=f'file-{len(outputs) + 1}', kind='csv' if path.endswith('.csv') else 'json', path=path, metricKey=metric_key(key) if key else '',
                    entryIds=ids, evidence=evidence, note='Literal result path candidate; confirm working directory/key; CSV requires exactly one data row'))
            dataset = group(r'\b(load_(?:iris|wine|digits|breast_cancer|diabetes))\s*\(', line)
            split = group(r'(\btrain_test_split\(.{0,200}?\))', ' '.join(code_lines[index:index + 6])) if find(r'\btrain_test_split\(', line) else None
            model = group(r'(\b(?:[A-Za-z_]\w*(?:Classifier|Regression|KNN|MLP)|KNN|MLP)\([^\n]{0,100}\))', line)
            checkpoint = group(r'''(?:torch\.load|joblib\.load|lzma\.open|load_model)\(\s*["']([^"']+)["']''', line)
            config = find(r'''^\s*["']?((?:data|dataset|model|checkpoint|weights)(?:[_-](?:path|file|name))?)["']?\s*[:=]\s*["']?([^"'\n#,}]+)["']?''', line) if not find(r'\.py$', file['path'], re.I) else None
            if config:
                contexts.append(dict(kind='dataset' if find(r'^(?:data|dataset)', config[1]) else 'model',
                    value=f'Config declaration: {config[1]}={config[2].strip()}; review actual loader and split', entryIds=ids, evidence=evidence))
            for item in matches(r'''["']([^"'\n]+\.(?:ya?ml|toml|jsonl?|csv|xlsx?|pt|pth|ckpt|joblib|pkl|pickle(?:\.lzma)?))["']''', line, re.I):
                path = item[1]
                if find(r'^[\\/]|[\r\n\0]|^(?:[A-Za-z]:|https?:)|(?:^|[\\/])\.\.(?:[\\/]|$)', path):
                    continue
                paths.append(dict(kind='config' if find(r'\.ya?ml$|\.toml$', path) else 'checkpoint' if find(r'\.(?:pt|pth|ckpt|pickle|pkl|joblib)', path) else 'data-or-output',
                    path=path, matches=[path] if path in file_paths else [candidate for candidate in file_paths if candidate.endswith('/' + path)],
                    entryIds=ids, evidence=evidence, note='Literal path only; matches do not prove working-directory correctness or that an asset was prepared'))
            if dataset or model or checkpoint:
                contexts.append(dict(kind='dataset' if dataset else 'model', entryIds=ids, evidence=evidence,
                    value=f"Built-in sklearn {dataset}; review original split in {file['path']}" if dataset else f"Code candidate: {checkpoint if checkpoint is not None else model}; review original model/preparation in {file['path']}"))
            if split:
                contexts.append(dict(kind='split', entryIds=ids, value=split, evidence=evidence))
    training = [entry for entry in entrypoints if entry['category'] == 'training']
    for file in files:
        if find(r'(?:^|/)train[\w-]*\.py$', file['path'], re.I) and find(r'__main__|\.fit\(|ArgumentParser', file['text']):
            if not any(ref['path'] == file['path'] for entry in training for ref in entry['references']):
                training.append(dict(id=f'training-code-{len(training) + 1}', command=f"python {quote(file['path'])}", category='training', origin='inferred-script',
                    evidence=source(file['path'], 1, lines(file['text'])[0]), references=[dict(path=file['path'], exists=True)]))
    return dict(status='NEEDS_REVIEW' if entries else 'NO_EVALUATION_CANDIDATE', entries=entries[:20], trainingEntries=training[:20], references=references,
        outputs=outputs[:20], contexts=contexts[:20], paths=paths[:24], warnings=[
            'Candidates do not prove dataset/split/model equivalence or make repository code safe.',
            'Only sampled code and literal declarations are covered; missing information must be supplied, not invented.'])
