"""Native Python GitHub acquisition and base scan report; no repository code execution."""
import asyncio
import base64
import re
from urllib.parse import quote, urlsplit

import httpx

from .report import enrich_report


def match(pattern, text, flags=re.I | re.ASCII):
    return re.search(pattern, text, flags)


def first_line(text, pattern, flags=re.I | re.ASCII):
    return next(({'line': i + 1, 'text': line.strip()} for i, line in enumerate(text.splitlines())
                 if match(pattern, line, flags)), None)


def unique(items):
    return list(dict.fromkeys(items))


def parse_repo(value):
    try:
        url = urlsplit(value)
        parts = [part for part in url.path.split('/') if part]
        if url.scheme not in ('http', 'https') or url.hostname != 'github.com' or len(parts) != 2:
            raise ValueError()
    except ValueError:
        raise ValueError('请输入仓库首页地址，例如 https://github.com/owner/repo') from None
    return parts[0], re.sub(r'\.git$', '', parts[1])


def is_dependency(path):
    name = path.split('/')[-1].lower()
    return bool(match(r'^requirements(?:[-_.].*)?\.txt$', name) or name in (
        'pyproject.toml', 'poetry.lock', 'uv.lock', 'pipfile', 'pipfile.lock', 'environment.yml', 'environment.yaml'))


def dependency_versions(path, text):
    name = path.split('/')[-1].lower()
    locked = name in ('poetry.lock', 'uv.lock', 'pipfile.lock')
    if locked or not match(r'^requirements(?:[-_.].*)?\.txt$', name):
        return dict(verifiable=locked, lockFile=locked, total=None, unpinned=[])
    lines = [re.sub(r'\s+#.*$', '', line).strip() for line in text.splitlines()]
    deps = [line for line in lines if line and not line.startswith(('#', '-'))]
    unpinned = [line for line in deps if not match(
        r'^[A-Za-z0-9_.-]+(?:\[[^\]]+\])?\s*={2,3}\s*[^\s;,*]+(?:\s*;.*)?$', line)]
    return dict(verifiable=True, lockFile=False, total=len(deps), unpinned=unpinned)


def python_version(path, text):
    name = path.split('/')[-1].lower()
    patterns = {'.python-version': r'(?:python-)?(\d+\.\d+(?:\.\d+)?)',
                'runtime.txt': r'(?:python-)?(\d+\.\d+(?:\.\d+)?)',
                'dockerfile': r'^\s*FROM\s+python:(\d+\.\d+(?:\.\d+)?)',
                'environment.yml': r'^\s*-\s*python\s*=\s*(\d+\.\d+(?:\.\d+)?)',
                'environment.yaml': r'^\s*-\s*python\s*=\s*(\d+\.\d+(?:\.\d+)?)',
                'pyproject.toml': r'''^\s*(?:requires-python|python)\s*=\s*["']([^"']+)["']'''}
    found = match(patterns[name], text, re.I | re.M | re.ASCII)
    if not found:
        return None
    value = found[1].strip()
    return {'value': value, 'exact': bool(match(r'^(?:==)?\d+\.\d+\.\d+(?:[-+][\w.]+)?$', value))}


def classify(command, section):
    script_match = match(r'(?:^|\s)([\w./-]+\.py)\b', command)
    script = script_match[1].split('/')[-1] if script_match else ''
    patterns = [('preprocess', r'preprocess|prepare|tokeniz|dataset|data'),
                ('evaluation', r'^(?:eval|evaluate|benchmark|test)'),
                ('training', r'train|finetun|pretrain|sft|dpo|grpo|ppo|lora'),
                ('inference', r'infer|predict|generate|chat|conversation'),
                ('demo', r'demo|web|server|serve|gradio|streamlit')]
    for category, pattern in patterns:
        if match(pattern, script):
            return category
    contextual = [('preprocess', r'preprocess|prepare|tokeniz|dataset|\bdata\b|预处理|数据|分词'),
                  ('evaluation', r'eval|evaluate|benchmark|\btest\b|评估|测评|测试'),
                  ('inference', r'infer|predict|generate|chat|conversation|推理|对话|聊天|生成'),
                  ('demo', r'demo|web|server|serve|gradio|streamlit|演示|部署|服务'),
                  ('training', r'train|finetun|fine[-_ ]?tun|sft|dpo|grpo|ppo|lora|训练|微调')]
    for text in (section or '', command):
        for category, pattern in contextual:
            if match(pattern, text):
                return category
    return 'other'


def run_commands(text):
    commands, seen, section, fenced = [], set(), None, False
    for index, line in enumerate(text.splitlines()):
        if match(r'^\s*(?:```|~~~)', line):
            fenced = not fenced
            continue
        heading = match(r'^\s*#{1,6}\s+(.+?)\s*$', line) if not fenced else None
        if heading:
            section = heading[1]
        value = line.strip()
        runnable = match(r'^(?:[-*]\s+)?(?:[$>]\s*)?(?:(?:cd|pushd)\s+\S+\s*&&\s*)?(?:python3?(?:\s+-m\s+\S+|\s+\S+\.py\b)|torchrun\s+.*?\.py\b|accelerate\s+launch\s+.*?\.py\b)', value)
        if not runnable or match(r'(?:^|[/_.-])xxx(?:[/_.-]|$)|<[^>]+>|\{[^}]+\}', value) or value in seen:
            continue
        commands.append(dict(line=index + 1, text=value, section=section, category=classify(value, section)))
        seen.add(value)
        if len(commands) == 60:
            break
    return commands


def instruction(text, subject):
    action = r'\b(?:download|prepare|fetch|place|copy|wget|curl|git clone|huggingface-cli|modelscope)\b|下载|获取|准备|放入|复制'
    link = r'https?://|\[[^\]]+\]\([^)]+\)|\b(?:wget|curl|git clone|huggingface-cli|modelscope)\b'
    candidates = [dict(line=i + 1, text=line.strip()) for i, line in enumerate(text.splitlines())
                  if match(subject, line) and match(action, line) and (match(r'^\s*#{1,6}\s+', line) or match(link, line))]
    return next((item for item in candidates if match(link, item['text'])), candidates[0] if candidates else None)


def command_paths(command):
    tokens = [re.sub(r'[;,)]+$', '', re.sub(r'''^['"]|['"]$''', '', token)).replace('\\', '/')
              for token in re.findall(r'''"[^"]*"|'[^']*'|\S+''', command or '')]
    paths = []

    def add(value):
        value = re.sub(r'^\./', '', value or '')
        if value and not match(r'^(?:https?:|\$|--?)', value):
            paths.append(value)

    for index, value in enumerate(tokens):
        token = value.lower()
        following = tokens[index + 1] if index + 1 < len(tokens) else None
        if token in ('-r', '--requirement', '--config', '--config-file', '--cfg'):
            add(following)
        if match(r'^--(?:requirement|config|config-file|cfg)=', token):
            add(value.split('=', 1)[1])
        if match(r'^(?:python3?|torchrun)$', token) or (token == 'accelerate' and (following or '').lower() == 'launch'):
            add(next((item for item in tokens[index + 1:] if match(r'\.py$', item)), None))
    return unique(paths)


def references(commands, files):
    results = []
    for item in commands:
        directory_match = match(r'\b(?:cd|pushd)\s+([^\s&]+)\s*&&', item.get('command') or '')
        directory = re.sub(r'^\./', '', directory_match[1]).rstrip('/') if directory_match else None
        external = bool(match(r'https?://github\.com/', item.get('section') or ''))
        for path in command_paths(item.get('command')):
            suffix = [candidate for candidate in files if candidate.endswith('/' + path)]
            resolved = next((candidate for candidate in (path, f'{directory}/{path}' if directory else None)
                             if candidate in files), suffix[0] if len(suffix) == 1 else None)
            results.append(dict(step=item['id'], path=resolved or path, exists=True if resolved else None if external else False,
                                **({'external': True} if external and not resolved else {})))
    return results


def parameters(files):
    result, seen = [], set()
    for file in files:
        for index, line in enumerate(file['text'].splitlines()):
            argument = match(r'''\.add_argument\(\s*["'](--[\w-]+)["']''', line, re.ASCII)
            config = None if match(r'\.py$', file['path']) else match(r'''^\s*["']?([A-Za-z_][\w.-]*)["']?\s*[:=]\s*(.+?)\s*,?\s*$''', line, re.ASCII)
            name = argument[1] if argument else config[1] if config and match(r'epoch|batch|learning[_-]?rate|^lr$|seed|model|data|device|max[_-]?(?:seq|length)|hidden', config[1]) else None
            key = re.sub(r'^--', '', name or '').replace('-', '_')
            if not name or key in seen:
                continue
            default = match(r'\bdefault\s*=\s*([^,)]+)', line, re.ASCII) if argument else None
            raw = default[1].strip() if default else None if argument else re.sub(r',$', '', re.sub(r'\s+#.*$', '', config[2])).strip()
            result.append(dict(name=name, default=re.sub(r'''^["']|["']$''', '', raw) if raw is not None else None,
                               file=file['path'], line=index + 1, source='argparse' if argument else 'config'))
            seen.add(key)
            if len(result) == 12:
                return result
    return result


def reproduction_plan(readme, install, run, data, model, version_file, version, refs, params):
    def evidence(value):
        return {'file': readme, **value} if value else None

    steps = [dict(id='environment', title='Prepare Python environment', status='DOCUMENTED' if version else 'MISSING',
                  instruction=f"Use Python {version['value']}" if version else None,
                  evidence=dict(file=version_file, text=version['value']) if version else None)]
    for step_id, title, value, field in (
        ('install', 'Install dependencies', install, 'command'),
        ('model', 'Get model or checkpoint', model, 'instruction'),
        ('data', 'Get and prepare dataset', data, 'instruction'),
        ('run', 'Run the experiment', run, 'command')):
        step = dict(id=step_id, title=title, status='DOCUMENTED' if value else 'MISSING', evidence=evidence(value))
        step[field] = value['text'] if value else None
        if field == 'command':
            step['references'] = [ref for ref in refs if ref['step'] == step_id]
        if step_id == 'run':
            step['parameters'] = params
        steps.append(step)
    missing = [ref for ref in refs if ref['exists'] is False]
    gaps = [dict(type='missing_step', step=step['id'], message=f"{step['title']} was not automatically recognized; review the source instructions")
            for step in steps if step['status'] == 'MISSING']
    gaps += [dict(type='missing_reference', step=ref['step'], path=ref['path'], message=f"{ref['path']} does not exist in the repository") for ref in missing]
    return dict(status='BLOCKED' if missing else 'INCOMPLETE' if gaps else 'READY', gaps=gaps, steps=steps)


class GitHub:
    def __init__(self, client, token=None):
        self.client = client
        self.headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'reprocheck'}
        if token:
            self.headers['Authorization'] = f'Bearer {token}'

    async def get(self, path):
        try:
            response = await self.client.get('https://api.github.com' + path, headers=self.headers)
        except httpx.RequestError:
            raise ValueError('GitHub API connection failed or timed out') from None
        if not response.is_success:
            raise ValueError(f'GitHub API 请求失败：{response.status_code}')
        try:
            return response.json()
        except ValueError:
            raise ValueError('GitHub API returned invalid JSON') from None

    async def file(self, base, path, ref):
        if not path:
            return ''
        value = await self.get(f'{base}/contents/{quote(path, safe="/")}?ref={quote(ref, safe="")}')
        return base64.b64decode(value['content']).decode('utf-8', errors='replace') if value.get('content') else ''


async def scan(url, token=None, pinned_commit=None, *, client=None):
    if pinned_commit is not None and (not isinstance(pinned_commit, str) or not re.fullmatch(r'[a-fA-F0-9]{40}', pinned_commit)):
        raise ValueError('Invalid pinned source commit')
    owner, repo = parse_repo(url)
    if client is None:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as owned:
            return await scan(url, token, pinned_commit, client=owned)
    github = GitHub(client, token)
    base = f'/repos/{quote(owner, safe="")}/{quote(repo, safe="")}'
    repository = await github.get(base)
    commit = await github.get(f'{base}/commits/{quote(pinned_commit or repository["default_branch"], safe="")}')
    tree = await github.get(f'{base}/git/trees/{quote(commit["commit"]["tree"]["sha"], safe="")}?recursive=1')
    if not isinstance(tree.get('tree'), list):
        raise ValueError('无法读取仓库文件树')
    if tree.get('truncated'):
        raise ValueError('仓库文件树过大，GitHub 返回结果不完整')
    paths = [entry['path'] for entry in tree['tree']]
    files = [entry['path'] for entry in tree['tree'] if entry['type'] == 'blob']
    roots = [path for path in files if '/' not in path]
    readme = next((path for path in roots if match(r'^readme(\.|$)', path)), None)
    deps = [path for path in files if is_dependency(path)]
    dependency = next((path for path in deps if path.split('/')[-1].lower() in ('poetry.lock', 'uv.lock', 'pipfile.lock')), deps[0] if deps else None)
    version_file = next((path for name in ('.python-version', 'runtime.txt', 'dockerfile', 'pyproject.toml', 'environment.yml', 'environment.yaml')
                         for path in files if path.split('/')[-1].lower() == name), None)
    license_file = next((path for path in roots if match(r'^(?:licen[cs]e|copying)(?:[.-]|$)', path)), None)
    makefile = next((path for path in roots if match(r'^makefile$', path)), None)
    tests = next((path for path in paths if match(r'(?:^|/)(?:tests?(?:/|$)|(?:test_.+|.+_test)\.py$|(?:pytest\.ini|tox\.ini|noxfile\.py)$)', path)), None)
    ci = next((path for path in files if match(r'^\.github/workflows/.+\.ya?ml$', path)), None)
    readme_text, dep_text, version_text, make_text = await asyncio.gather(
        *(github.file(base, path, commit['sha']) for path in (readme, dependency, version_file, makefile)))
    install = first_line(readme_text, r'\b(?:pip3? install|poetry install|uv sync|conda env create)\b')
    commands = run_commands(readme_text)
    run = {key: commands[0][key] for key in ('line', 'text')} if commands else None
    entries = [dict(id=f"{command['category']}-{index + 1}", category=command['category'], command=command['text'],
                    section=command['section'], evidence=dict(file=readme, line=command['line'])) for index, command in enumerate(commands)]
    data = instruction(readme_text, r'\b(?:data|dataset)\b|数据(?:集)?')
    model = instruction(readme_text, r'\b(?:model|weights?|checkpoint|pre-?trained)\b|模型|权重|检查点')
    dep_versions = dependency_versions(dependency, dep_text) if dependency else None
    version = python_version(version_file, version_text) if version_file else None
    refs = references([dict(id='install', command=install['text'] if install else None), *entries], files)
    for entry in entries:
        entry['references'] = [ref for ref in refs if ref['step'] == entry['id']]
    candidates = unique(
        [ref['path'] for entry in entries if entry['category'] == 'evaluation' for ref in entry['references'] if ref['exists'] and match(r'\.py$', ref['path'])]
        + [ref['path'] for ref in refs if ref['exists'] and match(r'\.(?:ya?ml|toml|json)$', ref['path'])]
        + [path for path in files if match(r'(?:^|/)(?:eval(?:uate)?|benchmark)[\w-]*\.py$', path)][:2]
        + [ref['path'] for ref in refs if ref['exists'] and match(r'\.(?:py|ya?ml|toml|json)$', ref['path'])]
        + [path for path in files if match(r'\.(?:py|ya?ml|toml|json)$', path.split('/')[-1]) and match(r'seed|train|main|config', path.split('/')[-1])])[:5]
    texts = await asyncio.gather(*(github.file(base, path, commit['sha']) for path in candidates))
    code_files = [dict(path=path, text=text) for path, text in zip(candidates, texts)]
    seed, config = None, None
    config_path = next((path for path in files if match(r'(?:^|/)(?:configs?|conf)/.+\.(?:ya?ml|json|toml)$|(?:^|/)(?:config|settings)\.(?:py|ya?ml|json|toml)$', path)), None)
    if config_path:
        config = {'file': config_path}
    for file in code_files:
        found = first_line(file['text'], r'\b(?:random\.seed|numpy\.random\.seed|np\.random\.seed|torch(?:\.cuda)?\.manual_seed(?:_all)?|(?:set|setup)_seed)\s*\(|^\s*(?:random_)?seed\s*[:=]')
        if found and seed is None:
            seed = dict(file=file['path'], **found)
        found = first_line(file['text'], r'\b(?:ArgumentParser\s*\(|add_argument\s*\(|@hydra\.main\s*\()', re.ASCII)
        if found and config is None:
            config = dict(file=file['path'], **found)
    params = parameters(code_files)
    for entry in entries:
        entry['parameters'] = [param for param in params if any(ref['path'] == param['file'] for ref in entry['references'])]
    plan_refs = [ref for ref in refs if ref['step'] == 'install'] + [dict(ref, step='run') for ref in refs if entries and ref['step'] == entries[0]['id']]
    plan = reproduction_plan(readme, install, run, data, model, version_file, version, plan_refs, entries[0]['parameters'] if entries else [])
    checks = build_checks(readme, install, run, commands, data, model, dependency, dep_versions,
                          license_file, tests, version_file, version, seed, config, ci, refs)
    failures = sum(check['status'] == 'FAIL' for check in checks)
    warnings = sum(check['status'] == 'WARN' for check in checks)
    report = dict(repository=f'{owner}/{repo}', commit=commit['sha'], filesScanned=len(files),
                  status='BLOCKED' if failures else 'NEEDS_WORK' if warnings else 'READY_FOR_REVIEW',
                  summary=dict(failures=failures, warnings=warnings), checks=checks,
                  experimentParameters=params, entrypoints=entries, reproductionPlan=plan)
    return enrich_report(report=report, readme=readme, readme_text=readme_text,
        code_files=code_files, file_paths=files, makefile=makefile, makefile_text=make_text,
        lock=dict(treeEntries=tree['tree'], dependencyFile=dependency, dependencyVersions=dep_versions,
                  pythonVersionFile=version_file, pythonVersionResult=version, seedConfiguration=seed))


def build_checks(readme, install, run, commands, data, model, dependency, deps, license_file, tests, version_file, version, seed, config, ci, refs):
    checks = []

    def add(key, passed, success, failure, evidence, suggestion, severity='WARN'):
        checks.append(dict(id=key, status='PASS' if passed else severity, message=success if passed else failure,
                           evidence=evidence, suggestion=None if passed else suggestion))

    def ev(file, value=None):
        return dict(file=file, **(value or {})) if file else None

    add('readme', readme, f'README found: {readme}', 'README not found', ev(readme), 'Add README.md with installation and run instructions', 'FAIL')
    add('install_command', install, 'Install command found in README', 'Installation command not automatically recognized',
        ev(readme, install) if install else None, 'Review README setup instructions and dependency files; unsupported syntax may still document installation')
    add('run_command', commands, f'{len(commands)} Python run command candidate(s) identified (not executed)', 'Run command not automatically recognized',
        ev(readme, run) if run else None, 'Review README usage instructions and source entry points; absence of detection does not mean no instructions exist')
    add('data_instructions', data, 'Dataset instructions found in README', 'Dataset instructions not found in README',
        ev(readme, data) if data else None, 'Document where to get and how to prepare the dataset')
    add('model_instructions', model, 'Model or checkpoint instructions found in README', 'Model or checkpoint instructions not found in README',
        ev(readme, model) if model else None, 'Document pretrained weights or checkpoint generation')
    add('dependencies', dependency, f'Dependencies found: {dependency}', 'Dependencies not found', ev(dependency), 'Add requirements.txt or pyproject.toml', 'FAIL')
    locked = deps and deps['verifiable'] and (deps['lockFile'] or deps['total'] > 0 and not deps['unpinned'])
    if not deps:
        dep_message = 'Dependency versions cannot be checked'
    elif deps['lockFile']:
        dep_message = f'Dependency lock file found: {dependency}'
    elif not deps['verifiable']:
        dep_message = f'Dependency versions not verified: {dependency}'
    elif not deps['total']:
        dep_message = f'No direct dependencies found in {dependency}'
    elif not deps['unpinned']:
        dep_message = f"All {deps['total']} dependencies are exactly pinned"
    else:
        dep_message = f"{len(deps['unpinned'])} of {deps['total']} dependencies are not exactly pinned"
    dep_evidence = dict(file=dependency, text='Unpinned: ' + ', '.join(deps['unpinned'][:3]) if deps and deps['unpinned']
                        else 'Lock file provides resolved dependency versions' if deps and deps['lockFile'] else None) if dependency else None
    add('dependency_versions', locked, dep_message, dep_message, dep_evidence, 'Pin exact versions or commit a supported lock file')
    add('license', license_file, f'License found: {license_file}', 'License not found', ev(license_file), 'Add a LICENSE file')
    add('tests', tests, f'Test entry found: {tests}', 'Test entry not found', ev(tests), 'Add a tests directory or Python test file')
    exact = version and version['exact']
    add('python_version', exact, f"Python version exactly pinned: {version['value']}" if version else '',
        f"Python version constraint is not exact: {version['value']}" if version else 'Python version not clearly pinned',
        dict(file=version_file, text=version['value'] if version else None) if version_file else None,
        'Pin an exact Python patch version, for example 3.11.9')
    add('random_seed', seed, 'Random seed setup found in code', 'Random seed setup not found in sampled code', seed,
        'Set Python, NumPy, and framework random seeds in the training entry point')
    add('experiment_config', config, 'Reusable experiment configuration found', 'Reusable experiment configuration not found', config,
        'Expose experiment parameters through a config file or command-line arguments')
    add('continuous_integration', ci, f'Continuous integration found: {ci}', 'Continuous integration workflow not found', ev(ci),
        'Add a GitHub Actions workflow that installs dependencies and runs tests')
    missing = [ref for ref in refs if ref['exists'] is False]
    external = [ref for ref in refs if ref.get('external')]
    local = [ref for ref in refs if not ref.get('external')]
    message = f'{len(missing)} command reference(s) do not exist in the repository' if missing else (
        f'All {len(local)} local command reference(s) exist' + (f'; {len(external)} external reference(s) identified' if external else '')) if local else (
        f'{len(external)} external command reference(s) identified' if external else 'No local command references could be validated')
    evidence = next(({'file': ref['path']} for ref in local if ref['exists']), None)
    checks.append(dict(id='command_references', status='FAIL' if missing else 'PASS' if local else 'WARN', message=message,
                       evidence=evidence, suggestion='Fix missing paths: ' + ', '.join(ref['path'] for ref in missing) if missing
                       else None if local or external else 'Document commands that reference repository scripts or configuration files'))
    return checks
