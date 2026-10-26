"""Call only checked-in rules, with no shell or GitHub credentials."""
import asyncio
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


async def validate_execution_options(value):
    # Keep execution-option validation identical to the JS Docker runner.
    env = {key: value for key, value in os.environ.items()
           if key.upper() in ('PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP')}
    process = await asyncio.create_subprocess_exec(
        os.environ.get('REPROCHECK_NODE', 'node'), str(ROOT / 'backend/execution-options.mjs'),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, cwd=ROOT, env=env)
    try:
        output, _ = await asyncio.wait_for(
            process.communicate(json.dumps(value, ensure_ascii=False).encode()), 30)
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
    result = json.loads(output)
    if process.returncode:
        raise ValueError(result.get('error', 'Execution option validation failed'))
    return result
