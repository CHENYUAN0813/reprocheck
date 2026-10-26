import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSync } from 'rolldown/utils';
import { initialLanguage, LANGUAGE_KEY, translate, translateCheck } from './src/i18n.mjs';
import zh from './src/zh.json' with { type: 'json' };

const storage = value => ({ getItem: key => { assert.equal(key, LANGUAGE_KEY); return value; } });
assert.equal(initialLanguage(storage('en'), 'zh-CN'), 'en');
assert.equal(initialLanguage(storage('zh'), 'en-AU'), 'zh');
assert.equal(initialLanguage(storage('invalid'), 'zh-TW'), 'zh');
assert.equal(initialLanguage(undefined, 'en-AU'), 'en');
assert.equal(initialLanguage({ getItem() { throw new Error('blocked'); } }, 'zh-CN'), 'zh');
for (const [key, value] of Object.entries(zh)) {
  assert.ok(value.trim(), key);
  assert.equal(translate(key, 'en'), key);
  assert.equal(translate(key, 'zh'), value);
}
assert.equal(translate('  Scan report ', 'zh'), '  扫描报告 ');
assert.equal(translate('GitHub API 请求失败：403', 'en'), 'GitHub API request failed: 403');
assert.equal(translate('无法读取仓库文件树', 'en'), 'Unable to read the repository file tree');
assert.equal(translate('All 12 dependencies are exactly pinned', 'zh'), '全部 12 个依赖已固定精确版本');
assert.equal(translate('2 of 12 dependencies are not exactly pinned', 'zh'), '12 个依赖中有 2 个未固定精确版本');
assert.equal(translate('All 2 local command reference(s) exist; 3 external reference(s) identified', 'zh'), '全部 2 个本地命令引用存在；已识别 3 个外部引用');
const check = Object.freeze({ id: 'readme', message: 'README found: README.md', evidence: Object.freeze({ text: 'Run the experiment', file: 'README.md' }) });
assert.equal(translateCheck(check, 'zh'), '已找到 README：README.md');
assert.equal(translateCheck({ ...check, id: 'future-check' }, 'zh'), check.message);
assert.equal(check.evidence.text, 'Run the experiment');
for (const value of [0, false, null, undefined, [], {}, 'python train.py --seed 42', 'custom upstream failure']) {
  assert.equal(translate(value, 'zh'), value);
}

// UI localization must not change form values, request handlers or raw code/log expressions.
for (const file of ['src/main.jsx', 'src/RunConsole.jsx', 'src/WebVerification.jsx', 'src/NodeProject.jsx']) {
  const source = readFileSync(file, 'utf8');
  const result = parseSync(file, source);
  assert.equal(result.errors.length, 0, file);
  function walk(node, ancestors = []) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.name === 't') {
      const attribute = ancestors.findLast(n => n.type === 'JSXAttribute');
      assert.ok(!attribute || ['aria-label', 'alt', 'title', 'placeholder'].includes(attribute.name.name), `${file}: translated behavioral attribute`);
      const raw = ancestors.some(n => n.type === 'JSXElement' && ['code', 'pre'].includes(n.openingElement.name.name));
      if (raw && !attribute) assert.ok(source.slice(node.start, node.end).startsWith('t(job.status === "RUNNING" ?'), `${file}: translated source/log data`);
    }
    for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(child => walk(child, [...ancestors, node])) : walk(value, [...ancestors, node]);
  }
  walk(result.program);
}
console.log('PASS bilingual catalog, preferences, fallbacks, report identities, and raw evidence/form boundaries');
