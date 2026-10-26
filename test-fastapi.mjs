import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './scan.mjs';
import { reviewedCaseById, validateExecutionOptions } from './runner.mjs';
import { startScanService } from './scan-service.mjs';
import { handleApi } from './server.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const venv = join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const python = process.env.REPROCHECK_PYTHON || (existsSync(venv) ? venv : 'python');
const sha = 'a'.repeat(40), treeSha = 'b'.repeat(40);
const readme = '# Evaluation\npip install -r requirements.txt\npython eval.py --config configs/train.yaml\naccuracy: 0.98\nDownload dataset https://example.org/data.csv\nDownload model https://example.org/model.pt\n';
const files = {
  'README.md': readme, 'requirements.txt': 'numpy==1.26.4\nsklearn>=1\n# comment\n-r extra.txt\n',
  '.python-version': '3.11.9', LICENSE: 'MIT', 'tests/test_eval.py': '', '.github/workflows/ci.yml': '',
  'configs/train.yaml': 'batch_size: 32\nlearning_rate: 0.01\nseed: 42\nmodel_path: model.pt\n',
  'eval.py': 'import argparse\nrandom.seed(42)\np = argparse.ArgumentParser()\np.add_argument("--batch-size", default=32)\nprint("accuracy:", 0.98)\ndata = "data.csv"\n',
  'train.py': 'if __name__ == "__main__":\n    pass\n',
};
const cases = [
  ['empty', {}], ['evaluation', files],
  ['make', { 'README.md': '# Reproduction\nhttps://arxiv.org/abs/2207.01555\n```sh\nmake install\nmake download\nmake test\nmake reproduce\nmake verify\n```\nTable: accuracy\n| Dataset | MC |\n| --- | --- |\n| Beauty | 0.98 |\n',
    Makefile: 'install:\n\tpip install -r requirements.txt\ndownload:\n\techo data\ntest:\n\techo test\nreproduce:\n\tpython eval.py\nverify:\n\techo verify\n',
    'requirements.txt': 'numpy==1.26.4\n', 'eval.py': files['eval.py'], '.python-version': '3.11.9' }],
  ['nested-and-missing', { 'README.rst': '# Training\ncd src && python train.py --cfg=missing.yaml\n# Inference\npython infer.py\n# 外部 https://github.com/external/repo\npython external.py\n',
    'src/train.py': 'torch.manual_seed(1)\n', 'src/infer.py': 'print("ok")', 'pyproject.toml': 'requires-python = ">=3.10"' }],
  ['chinese-and-lock', { 'README.md': '# 推理\n```\npython main.py --config="configs/config.json"\n```\n从 https://example.org/data 下载数据集\n从 https://example.org/model 下载模型\nuv sync\n',
    'uv.lock': '', Dockerfile: 'FROM python:3.12.3-slim', 'configs/config.json': '{\n"seed": 123,\n"model": "weights.pt"\n}',
    'main.py': 'seed = 123\nif __name__ == "__main__":\n    print("accuracy:", .9)' }],
  ['training-selection', { 'README.md': '# Training\npython train.py --resume\npython train.py\npython train_pretrain.py\npython train_full_sft.py\n# Evaluation\npython evaluate.py\npoetry install\n',
    'train.py': 'setup_seed(123)', 'train_pretrain.py': '', 'train_full_sft.py': '', 'evaluate.py': '',
    'poetry.lock': '', 'environment.yml': 'dependencies:\n - python=3.11\n' }],
  ['requirements-empty', { 'README.md': 'pip install -r requirements.txt', 'requirements.txt': '# no packages\n', 'runtime.txt': 'python-3.12' }],
];
const fixtures = [];
const makeSource = {
  'README.md': '# Installation\nmake setup\nmake dependency\n# Prepare data\nmake data-public\n# Reproduce results\nmake test\nmake run\nmake run-cpu\nmake verify\n',
  Makefile: 'setup:\n\tpython -m venv .venv\ndependency:\n\tpip install -r requirements.txt\ndata-public:\n\tpython data.py\ntest:\n\tpython -m pytest\nrun:\n\tpython run.py\nrun-cpu:\n\tpython run.py --cpu\nverify:\n\tpython verify.py\n',
};
cases.push(['make-alternatives', makeSource],
  ['make-missing-targets', { ...makeSource, Makefile: makeSource.Makefile.replace('run-cpu:', 'other:').replace('setup:', 'missing-setup:') }]);
const candidateSource = {
  'README.md': '[Our Paper](https://arxiv.org/pdf/2401.01234.pdf)\n# Evaluation\npython eval.py\nAccuracy: 0.91\n',
  'requirements.txt': 'numpy==1.26.4',
  'eval.py': 'iris = load_iris()\ntrain_test_split(X, y, test_size=0.3, random_state=1)\nmodel = LogisticRegression()\nprint("Accuracy: %.4f" % score)\n',
};
cases.push(['candidate-suggestion', candidateSource],
  ['required-arguments', { ...candidateSource, 'eval.py': candidateSource['eval.py'] + 'parser.add_argument("checkpoint", help="Model path")\nparser.add_argument(\n "--config", required=True, help="Config file"\n)\nparser.add_argument("--seed", default=42, type=int)\nparser.add_argument("--gpu", action="store_true")\n' }],
  ['paper-ambiguity', { ...candidateSource, 'README.md': candidateSource['README.md'] + '[Other](https://openreview.net/forum?id=review-1)\ndoi:10.1145/123.456\n' }],
  ['table-metrics-and-file-output', { ...candidateSource,
    'README.md': candidateSource['README.md'] + '| Dataset | Accuracy | Loss |\n| --- | --- | --- |\n| Iris | 98% | 0.0000001 |\n| Wine | 0.95 | 0.000001 |\nFull-catalogue NDCG@10 from Table 1:\n\nData | MC | FMC\n--- | --- | ---\nBeauty | .0492 | .0481\n',
    'eval.py': 'json.dump({"accuracy":score}, open("results.json","w"))\njson.dump({},open("../escape.json","w"))\n' }]);
const originalFetch = globalThis.fetch;
const directory = mkdtempSync(join(tmpdir(), 'reprocheck-fastapi-'));
try {
  const scenarios = cases.map(([name, source]) => ({ name, source, input: { url: 'https://github.com/example/repo' } }));
  scenarios.push({ name: 'pinned', source: files, input: { url: 'https://github.com/example/repo', pinnedCommit: sha } });
  const saved = JSON.parse(readFileSync(new URL('./examples/experiment-iris-random-forest.json', import.meta.url)));
  scenarios.push({ name: 'saved-experiment', source: files, input: { url: `https://github.com/${saved.repository}`, executionOptions: saved.executionOptions } });
  for (const preset of reviewedCaseById.values()) scenarios.push({ name: preset.id, source: files,
    input: { url: `https://github.com/${preset.repository}`, executionOptions: { benchmarkId: preset.id } } });
  for (const scenario of scenarios) {
    const options = validateExecutionOptions(scenario.input.executionOptions);
    const pinned = options.benchmarkId ? reviewedCaseById.get(options.benchmarkId).commit : options.experiment?.commit ?? scenario.input.pinnedCommit;
    const commit = pinned ?? sha;
    const responses = {};
    globalThis.fetch = async url => {
      const parsed = new URL(url);
      let value;
      if (parsed.pathname.includes('/commits/')) value = { sha: commit, commit: { tree: { sha: treeSha } } };
      else if (parsed.pathname.includes('/git/trees/')) value = { tree: Object.keys(scenario.source).map((path, index) => ({ path, type: 'blob', sha: String(index).padStart(40, '0'), size: Buffer.byteLength(scenario.source[path]) })), truncated: false };
      else if (parsed.pathname.includes('/contents/')) {
        const path = decodeURIComponent(parsed.pathname.split('/contents/')[1]);
        assert.ok(path in scenario.source, path);
        value = { content: Buffer.from(scenario.source[path]).toString('base64') };
      } else value = { default_branch: 'main' };
      responses[String(url)] = value;
      return Response.json(value);
    };
    const expected = await scan(scenario.input.url, undefined, pinned);
    fixtures.push({ name: scenario.name, input: scenario.input, expected, responses });
  }
  globalThis.fetch = originalFetch;
  const fixturePath = join(directory, 'fixtures.json');
  writeFileSync(fixturePath, JSON.stringify(fixtures));
  const result = spawnSync(python, ['-m', 'backend.test_scan', fixturePath], { cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, REPROCHECK_NODE: process.execPath, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }, timeout: 120_000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, 'Python scanner contract/parity tests');

  const service = await startScanService();
  const server = createServer((request, response) => handleApi(request, response, service));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/scan`;
    for (const endpoint of ['scan', 'preflight', 'run']) {
      for (const input of [{ url: 'https://example.com/a/b' }, { url: 'https://github.com/a/b', executionOptions: { benchmarkId: 'unknown' } }]) {
        const result = await fetch(url.replace('/scan', `/${endpoint}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        assert.equal(result.status, 400);
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.ok((await result.json()).error);
      }
    }
    const rejected = await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(rejected.status, 403);
    await service.close();
    for (const endpoint of ['scan', 'preflight', 'run']) {
      assert.equal((await fetch(url.replace('/scan', `/${endpoint}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 502);
    }
    console.log('PASS FastAPI service startup, local gateway, origin gate, shutdown and unavailable-service response');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await service.close();
  }

  // Exercise successful report forwarding without executing any repository code.
  let scanResult, received;
  const routing = createServer((request, response) => handleApi(request, response, {
    request: async input => { received = input; return scanResult; },
  }));
  try {
    await new Promise(resolve => routing.listen(0, '127.0.0.1', resolve));
    globalThis.fetch = (url, options) => {
      assert.ok(String(url).startsWith('http://127.0.0.1:'), 'Execution routes must not invoke the legacy GitHub scanner');
      return originalFetch(url, options);
    };
    const post = (endpoint, input) => fetch(`http://127.0.0.1:${routing.address().port}/api/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    for (const fixture of fixtures.filter(item => ['evaluation', 'saved-experiment', ...reviewedCaseById.keys()].includes(item.name))) {
      scanResult = { status: 200, body: fixture.expected };
      const preset = reviewedCaseById.get(fixture.name);
      const input = { ...fixture.input, commit: fixture.expected.commit,
        workflowId: preset ? preset.matrix ? 'paper-matrix' : preset.training ? 'training' : 'evaluation' : fixture.name === 'saved-experiment' ? 'training' : 'quick',
        executionOptions: fixture.input.executionOptions ?? { quickEntryId: fixture.expected.quickEntries[0].id } };
      const preflight = await post('preflight', input);
      assert.equal(preflight.status, 200, `${fixture.name}: ${await preflight.clone().text()}`);
      assert.equal((await preflight.json()).commit, input.commit);
      assert.deepEqual(received, input, 'Forward preset/config and commit without altering the request');
      const run = await post('run', input);
      assert.equal(run.status, 400);
      assert.match((await run.json()).error, /Explicit confirmation/);
      for (const endpoint of ['preflight', 'run']) {
        const changed = await post(endpoint, { ...input, commit: 'f'.repeat(40) });
        assert.equal(changed.status, 409);
        assert.match((await changed.json()).error, /changed after scanning/);
        const missing = await post(endpoint, { ...input, commit: undefined });
        assert.equal(missing.status, 400);
        assert.match((await missing.json()).error, /scanned commit is required/);
      }
    }
    for (const status of [400, 500, 502]) {
      scanResult = { status, body: { error: 'Scan service rejected request' } };
      for (const endpoint of ['scan', 'preflight', 'run']) {
        const rejected = await post(endpoint, { url: 'https://github.com/example/repo', confirmUnknownCode: true });
        assert.equal(rejected.status, status);
        assert.deepEqual(await rejected.json(), scanResult.body);
      }
    }
    console.log('PASS preflight/run reuse scan reports for presets and saved experiments; commit/consent gates and scan errors preserved without legacy fallback');
  } finally {
    globalThis.fetch = originalFetch;
    routing.closeAllConnections();
    await new Promise(resolve => routing.close(resolve));
  }
} finally {
  globalThis.fetch = originalFetch;
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  rmSync(directory, { recursive: true, force: true });
}
