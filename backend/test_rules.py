"""Test-only stdin bridge: exercise Python rules from existing JS execution tests."""
import asyncio
import base64
import json
import sys
from urllib.parse import unquote

import httpx

from .evaluation_report import build_evaluation, suggest_candidate
from .paper_report import paper_matrix, paper_workflow, protocol_lock, provenance
from .scanner import scan


async def scan_sources(files):
    def transport(request):
        path = request.url.path
        if '/commits/' in path:
            value = dict(sha='a' * 40, commit=dict(tree=dict(sha='b' * 40)))
        elif '/git/trees/' in path:
            value = dict(tree=[dict(path=p, type='blob', sha='c' * 40, size=len(t.encode())) for p, t in files.items()], truncated=False)
        elif '/contents/' in path:
            value = dict(content=base64.b64encode(files[unquote(path.split('/contents/')[1])].encode()).decode())
        else:
            value = dict(default_branch='main')
        return httpx.Response(200, json=value)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        return await scan('https://github.com/example/research', client=client)


def run(action, value):
    if action == 'evaluation':
        return build_evaluation(value['readme'], value['readmeText'], value['entrypoints'], value['files'], value.get('filePaths', [f['path'] for f in value['files']]))
    if action == 'suggestion':
        return suggest_candidate(value)
    if action == 'provenance':
        return provenance(value['readme'], value['readmeText'], value['evaluationDraft'])
    if action == 'workflow':
        return paper_workflow(value['provenance'], value.get('makefile'), value.get('makefileText', ''), value.get('filePaths', []))
    if action == 'matrix':
        return paper_matrix(value)
    if action == 'lock':
        return protocol_lock(value['report'], value.get('readme'), value.get('makefile'), value)
    if action == 'scan':
        return asyncio.run(scan_sources(value))
    raise ValueError('Unknown test operation')


if __name__ == '__main__':
    request = json.load(sys.stdin)
    print(json.dumps(run(request['action'], request['value']), ensure_ascii=True))
