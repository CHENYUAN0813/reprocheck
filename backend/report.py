"""Compose the complete scan report in Python."""
import re

from .evaluation_report import build_evaluation, suggest_candidate
from .paper_report import paper_matrix, paper_workflow, protocol_lock, provenance
from .report_common import find


def workflow_status(steps, complete='READY'):
    return 'BLOCKED' if any(step['status'] == 'BLOCKED' for step in steps) else 'INCOMPLETE' if any(step['status'] == 'MISSING' for step in steps) else complete


def build_workflows(plan, entries):
    def first(category):
        return next((entry for entry in entries if entry['category'] == category), None)

    def score(entry):
        command = entry['command']
        return (100 if find(r'from_resume|resume', command, re.I) else 0) + (50 if find(r'\b(?:torchrun|accelerate\s+launch)\b', command, re.I) else 0) + (
            20 if any(ref['exists'] and '/' in ref['path'] and ref['path'] not in command and not find(r'\b(?:cd|pushd)\s+\S+\s*&&', command, re.I) for ref in entry['references']) else 0) + len(command.encode('utf-16-le', errors='surrogatepass')) / 2000

    training_candidates = [entry for entry in entries if entry['category'] == 'training']
    training = [first('preprocess'), min((entry for entry in training_candidates if find('pretrain', entry['command'], re.I)), key=score, default=None),
                min((entry for entry in training_candidates if find(r'full[_-]?sft|\bsft\b', entry['command'], re.I)), key=score, default=None)]
    training = [entry for entry in training if entry]
    if not training and training_candidates:
        training = [min(training_candidates, key=score)]
    quick = first('inference') or first('demo') or first('evaluation') or first('other') or (entries[0] if entries else None)
    prerequisites = ['environment', 'install'] + (['model'] if any(step['id'] == 'model' and step['status'] == 'DOCUMENTED' for step in plan['steps']) else [])
    result = []
    for identifier, title, required, chosen in (
        ('quick', 'Quick verification', prerequisites, [quick] if quick else []),
        ('training', 'Training', ['environment', 'install', 'data', 'model'], training),
        ('evaluation', 'Evaluation', ['environment', 'install', 'data', 'model'], [first('evaluation')] if first('evaluation') else [])):
        steps = [step for step in plan['steps'] if step['id'] in required] if chosen else []
        steps += [dict(id=entry['id'], title=entry['category'][0].upper() + entry['category'][1:] + ' entry point',
                       status='BLOCKED' if any(ref['exists'] is False for ref in entry['references']) else 'DOCUMENTED',
                       command=entry['command'], evidence=entry['evidence'], references=entry['references'], parameters=entry['parameters']) for entry in chosen]
        result.append(dict(id=identifier, title=title, status=workflow_status(steps) if chosen else 'UNAVAILABLE', steps=steps))
    return result


def reconcile(report):
    commands = report['paperWorkflowDraft']['commands']
    setup = [command for command in commands if command['role'] == 'setup']
    runs = [command for command in commands if command['role'] in ('preflight', 'experiment') and command['supported']]
    checks = {check['id']: check for check in report['checks']}
    plan = report['reproductionPlan']
    steps = {step['id']: step for step in plan['steps']}
    install = steps['install']
    if setup and install['status'] == 'MISSING':
        supported = all(command['supported'] for command in setup)
        checks['install_command'].update(status='PASS' if supported else 'WARN',
            message='Setup workflow identified; command targets validated (not executed)' if supported else 'Setup workflow identified, but some command targets could not be validated',
            evidence=setup[0]['evidence'], suggestion=None if supported else 'Review the documented setup commands and their source targets')
        install.update(status='DOCUMENTED' if supported else 'BLOCKED', command=' && '.join(item['command'] for item in setup) if supported else None, evidence=setup[0]['evidence'])
    if runs:
        checks['run_command'].update(status='PASS', message='Run/test workflow identified; command targets validated (not executed)', evidence=runs[0]['evidence'], suggestion=None)
        if steps['run']['status'] == 'MISSING':
            steps['run'].update(status='NEEDS_SELECTION', instruction='Choose a source-validated entry below for Quick verification', evidence=runs[0]['evidence'])
    test = next((item for item in runs if item['role'] == 'preflight'), None)
    if test and checks['tests']['status'] == 'WARN':
        checks['tests'].update(status='PASS', message='Test workflow target validated (not executed)', evidence=test['evidence'], suggestion=None)
    validated = [command for command in commands if command['supported']]
    if validated and checks['command_references']['status'] == 'WARN':
        checks['command_references'].update(status='PASS', message=f'{len(validated)} workflow command target(s) validated; internal dependencies are not checked', evidence=validated[0]['validation'], suggestion=None)

    def as_step(item):
        return dict(id=item['id'], title=f"{item['role']} · {item['command']}", command=item['command'], status='DOCUMENTED' if item['supported'] else 'BLOCKED', evidence=item['evidence'], validation=item['validation'])

    prerequisites = [item for item in commands if item['role'] in ('setup', 'prepare')]
    quick_entries = []
    for run in runs:
        run_steps = ([] if setup else [install]) + [as_step(item) for item in prerequisites] + [as_step(run)]
        quick_entries.append(dict(id=run['id'], command=run['command'], role=run['role'], evidence=run['evidence'], steps=run_steps, status=workflow_status(run_steps, 'NEEDS_REVIEW')))
    paper_commands = {item['command'] for item in quick_entries}
    for entry in report['entrypoints']:
        if (find(r'^(?:(?:cd|pushd)\s+\S+\s*&&\s*)?python3?\s', entry['command'])
            and any(ref['exists'] and find(r'\.py$', ref['path'], re.I) for ref in entry['references'])
            and all(ref['exists'] is True for ref in entry['references']) and entry['command'] not in paper_commands):
            run_steps = build_workflows(plan, [entry])[0]['steps']
            quick_entries.append(dict(id=entry['id'], command=entry['command'], role=entry['category'], evidence=entry['evidence'], steps=run_steps, status=workflow_status(run_steps, 'NEEDS_REVIEW')))
    seen = set()
    report['quickEntries'] = []
    for entry in quick_entries:
        if entry['command'] not in seen:
            seen.add(entry['command'])
            report['quickEntries'].append(entry)
    available = [entry for entry in report['quickEntries'] if entry['status'] != 'BLOCKED']
    tests = [entry for entry in available if entry['role'] == 'preflight']
    report['recommendedQuickEntryId'] = tests[0]['id'] if len(tests) == 1 else available[0]['id'] if len(available) == 1 else None
    report['workflows'] = build_workflows(plan, report['entrypoints'])
    if report['quickEntries']:
        report['workflows'][0].update(status='NEEDS_SELECTION', steps=[])
    plan['gaps'] = [gap for gap in plan['gaps'] if gap['type'] != 'missing_step' or steps[gap['step']]['status'] == 'MISSING']
    plan['status'] = 'BLOCKED' if any(step['status'] == 'BLOCKED' for step in plan['steps']) or any(gap['type'] == 'missing_reference' for gap in plan['gaps']) else 'INCOMPLETE' if any(step['status'] in ('MISSING', 'NEEDS_SELECTION') for step in plan['steps']) else 'READY'
    failures = sum(check['status'] == 'FAIL' for check in report['checks'])
    warnings = sum(check['status'] == 'WARN' for check in report['checks'])
    report['summary'] = dict(failures=failures, warnings=warnings)
    report['status'] = 'BLOCKED' if failures else 'NEEDS_WORK' if warnings else 'READY_FOR_REVIEW'


def enrich_report(report, readme, readme_text, code_files, file_paths, makefile, makefile_text, lock):
    report['evaluationDraft'] = build_evaluation(readme, readme_text, report['entrypoints'], code_files, file_paths)
    report['evaluationDraft']['suggestion'] = suggest_candidate(report)
    report['paperProvenance'] = provenance(readme, readme_text, report['evaluationDraft'])
    report['paperWorkflowDraft'] = paper_workflow(report['paperProvenance'], makefile, makefile_text, file_paths)
    reconcile(report)
    report['protocolLock'] = protocol_lock(report, readme, makefile, lock)
    report['paperMatrixDraft'] = paper_matrix(report)
    return report
