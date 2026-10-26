import asyncio
import json
import os
import re
import secrets
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .rules import validate_execution_options
from .scanner import scan

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def response(status, value, headers=None):
    return JSONResponse(value, status_code=status, headers={'Cache-Control': 'no-store', **(headers or {})})


def reject_non_finite(_):
    raise ValueError('Invalid JSON number')


@app.middleware('http')
async def local_only(request, call_next):
    service_token = os.environ.get('SCAN_SERVICE_TOKEN')
    if service_token:
        # Hosted mode is explicitly opt-in and authenticates every scan request.
        if request.url.path == '/health' and request.method == 'GET':
            return await call_next(request)
        expected = f'Bearer {service_token}'.encode()
        supplied = request.headers.get('authorization', '').encode()
        if len(service_token) < 32 or not secrets.compare_digest(supplied, expected):
            return response(401, {'error': 'Scan service authentication required'})
        return await call_next(request)
    host = request.headers.get('host', '')
    origin = f'http://{host}'
    try:
        allowed = urlsplit(origin).hostname in ('127.0.0.1', 'localhost', '::1')
    except ValueError:
        allowed = False
    if not allowed or request.headers.get('origin', origin) != origin:
        return response(403, {'error': 'Local API requests must come from this ReproCheck origin'})
    return await call_next(request)


@app.get('/health')
async def health():
    return response(200, {'service': 'reprocheck-scan', 'backend': 'fastapi'})


@app.api_route('/api/scan', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
async def scan_request(request: Request):
    if request.method != 'POST':
        return response(405, {'error': 'Method not allowed'}, {'Allow': 'POST'})
    try:
        if not re.match(r'^application/json(?:\s*;|$)', request.headers.get('content-type', ''), re.I):
            raise ValueError('API POST requests must use application/json')
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 32_000:
                raise ValueError('Request body is too large')
        try:
            value = json.loads(body, parse_constant=reject_non_finite)
        except (ValueError, UnicodeDecodeError):
            raise ValueError('Invalid JSON request body') from None
        if not isinstance(value, dict) or not isinstance(value.get('url'), str):
            raise ValueError('A GitHub repository URL is required')
        async with asyncio.timeout(180):
            options = await validate_execution_options(value)
            # Preserve the old distinction between omitted commit and explicitly invalid null.
            if 'pinnedCommit' in options and options['pinnedCommit'] is None:
                raise ValueError('Invalid pinned source commit')
            report = await scan(value['url'], os.environ.get('GITHUB_TOKEN'), options.get('pinnedCommit'))
        return response(200, report)
    except TimeoutError:
        return response(502, {'error': 'GitHub API scan timed out'})
    except ValueError as error:
        message = str(error)
        return response(502 if message.startswith('GitHub API') else 400, {'error': message})
    except Exception:
        # Do not expose environment, credentials, source contents or local paths in errors.
        return response(500, {'error': 'Unable to generate scan report'})
