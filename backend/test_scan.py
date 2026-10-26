"""Differential contracts against the existing JS scanner, with mocked GitHub only."""
import asyncio
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

import httpx

from .app import app
from .scanner import scan


def difference(left, right, path='$'):
    if isinstance(left, dict) and isinstance(right, dict):
        if left.keys() != right.keys():
            return f'{path}: keys differ: expected-only {left.keys() - right.keys()}, actual-only {right.keys() - left.keys()}'
        for key in left:
            found = difference(left[key], right[key], f'{path}.{key}')
            if found:
                return found
    elif isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            return f'{path}: lengths {len(left)} != {len(right)}'
        for index, (a, b) in enumerate(zip(left, right)):
            found = difference(a, b, f'{path}[{index}]')
            if found:
                return found
    elif left != right:
        return f'{path}: expected {left!r}, actual {right!r}'
    return None


async def main():
    fixtures = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1') as api:
        for fixture in fixtures:
            requested = []

            async def transport(request):
                url = str(request.url)
                requested.append(url)
                assert url in fixture['responses'], f'Unexpected upstream request: {url}'
                return httpx.Response(200, json=fixture['responses'][url])

            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as github:
                async def scan_fixture(url, token, pinned):
                    with patch('asyncio.create_subprocess_exec', side_effect=AssertionError('Report generation must stay in Python')):
                        return await scan(url, token, pinned, client=github)
                with patch('backend.app.scan', scan_fixture):
                    result = await api.post('/api/scan', json=fixture['input'])
                assert result.status_code == 200, (fixture['name'], result.text)
                diff = difference(fixture['expected'], result.json())
                assert not diff, f"{fixture['name']}: {diff}"
                assert set(requested) == set(fixture['responses']), fixture['name']
                assert result.headers['cache-control'] == 'no-store'
            print(f"PASS Frozen report contract: {fixture['name']}")

        async def must_not_scan(*args):
            raise AssertionError('Invalid input must not reach GitHub')

        with patch('backend.app.scan', must_not_scan):
            for value in (None, [], {}, {'url': 12}, {'url': 'https://github.com/a/b', 'executionOptions': None},
                          {'url': 'https://github.com/a/b', 'executionOptions': {'benchmarkId': 'unknown'}},
                          {'url': 'https://github.com/a/b', 'pinnedCommit': None},
                          {'url': 'https://github.com/a/b', 'pinnedCommit': 'f' * 40, 'executionOptions': {'benchmarkId': 'bthowen-iris'}},
                          {'url': 'https://github.com/a/b', 'executionOptions': {'metricTolerance': -1}}):
                result = await api.post('/api/scan', json=value)
                assert result.status_code == 400, result.text
                assert 'error' in result.json()
            assert (await api.post('/api/scan', content='{}')).status_code == 400
            assert (await api.post('/api/scan', content='{', headers={'content-type': 'application/json'})).status_code == 400
            assert (await api.post('/api/scan', content='{"url": NaN}', headers={'content-type': 'application/json'})).status_code == 400
            assert (await api.post('/api/scan', content='x' * 32001, headers={'content-type': 'application/json'})).status_code == 400
            assert (await api.post('/api/scan', json={}, headers={'origin': 'https://evil.example'})).status_code == 403
            assert (await api.post('/api/scan', json={}, headers={'host': 'evil.example'})).status_code == 403
            result = await api.get('/api/scan')
            assert result.status_code == 405 and result.headers['allow'] == 'POST'

        async def no_network(request):
            raise AssertionError('Invalid URL/commit must not fetch')

        async with httpx.AsyncClient(transport=httpx.MockTransport(no_network)) as github:
            for url, commit in [('https://example.org/a/b', None), ('https://github.com/a/b/tree/main', None),
                                ('https://github.com/a/b', 'main'), ('https://github.com/a/b', '../main'), ('https://github.com/a/b', '')]:
                try:
                    await scan(url, pinned_commit=commit, client=github)
                except ValueError:
                    pass
                else:
                    raise AssertionError('Invalid URL or commit accepted')

        for status in (401, 403, 404, 500):
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(status))) as github:
                async def upstream_failure(url, token, pinned):
                    with patch('asyncio.create_subprocess_exec', side_effect=AssertionError('Report generation must stay in Python')):
                        return await scan(url, token, pinned, client=github)
                with patch('backend.app.scan', upstream_failure):
                    result = await api.post('/api/scan', json={'url': 'https://github.com/a/b'})
                    assert result.status_code == 502 and str(status) in result.json()['error']
        for tree in ({'tree': [], 'truncated': True}, {'tree': None}):
            async def invalid_tree(request):
                if '/git/trees/' in str(request.url):
                    value = tree
                elif '/commits/' in str(request.url):
                    value = {'sha': 'a' * 40, 'commit': {'tree': {'sha': 'b' * 40}}}
                else:
                    value = {'default_branch': 'main'}
                return httpx.Response(200, json=value)
            async with httpx.AsyncClient(transport=httpx.MockTransport(invalid_tree)) as github:
                try:
                    await scan('https://github.com/a/b', client=github)
                except ValueError:
                    pass
                else:
                    raise AssertionError('Invalid tree accepted')
        with patch.dict(os.environ, {'SCAN_SERVICE_TOKEN': 'test-only-' * 4}):
            assert (await api.post('/api/scan', json={'url': 'https://github.com/a/b'})).status_code == 401
            assert (await api.post('/api/scan', headers={'Authorization': 'Bearer wrong'}, json={})).status_code == 401
            assert (await api.get('/health')).status_code == 200
            async def hosted_scan(*args):
                return {'repository': 'a/b', 'commit': 'a' * 40}
            with patch('backend.app.scan', hosted_scan):
                result = await api.post('/api/scan', headers={'host': 'scanner.example', 'Authorization': 'Bearer ' + 'test-only-' * 4}, json={'url': 'https://github.com/a/b'})
                assert result.status_code == 200, result.text
        with patch.dict(os.environ, {'SCAN_SERVICE_TOKEN': 'short'}):
            assert (await api.post('/api/scan', headers={'Authorization': 'Bearer short'}, json={})).status_code == 401
    print('PASS FastAPI local gates, hosted authentication, validation, fixed commits and upstream failures')


if __name__ == '__main__':
    asyncio.run(main())
