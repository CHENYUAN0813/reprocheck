import zh from './zh.json' with { type: 'json' };

export const LANGUAGE_KEY = 'reprocheck.language';

const checkIds = new Set(['node_manifest', 'node_lock', 'node_version', 'node_scripts', 'node_install_instructions', 'node_run_instructions', 'node_coverage', 'project_type', 'readme', 'install_command', 'run_command', 'command_references',
  'dependencies', 'dependency_versions', 'python_version', 'data_instructions',
  'model_instructions', 'random_seed', 'experiment_config', 'tests', 'continuous_integration', 'license']);

export function translateCheck(check, language) {
  return checkIds.has(check.id.split(':')[0]) ? translate(check.message, language) : check.message;
}

const englishErrors = {
  '请输入仓库首页地址，例如 https://github.com/owner/repo': 'Enter a repository URL, for example https://github.com/owner/repo',
  '无法读取仓库文件树': 'Unable to read the repository file tree',
  '仓库文件树过大，GitHub 返回结果不完整': 'Repository file tree is too large; GitHub returned incomplete results',
};

// Only recognized product messages are translated; captured source and logs bypass this function.
const messages = [
  [/^Invalid\ package\.json:\ (.+)$/, (_, value) => `package.json 无效：${value}`],
  [/^Node\ dependency\ manifest\ found:\ (.+)$/, (_, value) => `已找到 Node 依赖清单：${value}`],
  [/^npm\ lock\ file\ parsed:\ (.+)$/, (_, value) => `已解析 npm 锁文件：${value}`],
  [/^npm\ lock\ file\ missing\ or\ invalid:\ (.+)$/, (_, value) => `npm 锁文件缺失或无效：${value}`],
  [/^Node\.js\ requirement\ declared:\ (.+)$/, (_, value) => `已声明 Node.js 版本要求：${value}`],
  [/^Node\.js\ requirement\ not\ declared:\ (.+)$/, (_, value) => `未声明 Node.js 版本要求：${value}`],
  [/^npm\ scripts\ declared\ \(not\ executed\):\ (.+)$/, (_, value) => `已声明 npm 脚本（未执行）：${value}`],
  [/^No\ npm\ scripts\ declared:\ (.+)$/, (_, value) => `未声明 npm 脚本：${value}`],
  [/^Required arguments need values: (.+)$/, (_, names) => `必填参数缺少值：${names}`],
  [/^Tree matches: (.+)$/, (_, paths) => `文件树匹配：${paths}`],
  [/^Reviewed (.+) software case: input hashes and the pinned README row must pass checks before entry and at completion\. This is not full-paper reproduction or a security attestation\.$/, (_, name) => `已审查的 ${name} 软件案例：输入哈希和固定 README 参考行必须在入口执行前及完成时通过检查。这不代表整篇论文复现或安全认证。`],
  [/^README found: (.+)$/, (_, path) => `已找到 README：${path}`],
  [/^Dependencies found: (.+)$/, (_, path) => `已找到依赖文件：${path}`],
  [/^License found: (.+)$/, (_, path) => `已找到许可证：${path}`],
  [/^Test entry found: (.+)$/, (_, path) => `已找到测试入口：${path}`],
  [/^Continuous integration found: (.+)$/, (_, path) => `已找到持续集成：${path}`],
  [/^Dependency lock file found: (.+)$/, (_, path) => `已找到依赖锁文件：${path}`],
  [/^Dependency versions not verified: (.+)$/, (_, path) => `依赖版本未验证：${path}`],
  [/^No direct dependencies found in (.+)$/, (_, path) => `${path} 中未找到直接依赖`],
  [/^All (\d+) dependencies are exactly pinned$/, (_, n) => `全部 ${n} 个依赖已固定精确版本`],
  [/^(\d+) of (\d+) dependencies are not exactly pinned$/, (_, n, total) => `${total} 个依赖中有 ${n} 个未固定精确版本`],
  [/^Python version exactly pinned: (.+)$/, (_, version) => `Python 版本已精确固定：${version}`],
  [/^Python version constraint is not exact: (.+)$/, (_, version) => `Python 版本约束不精确：${version}`],
  [/^(\d+) Python run command candidate\(s\) identified \(not executed\)$/, (_, n) => `已识别 ${n} 个 Python 运行命令候选（未执行）`],
  [/^(\d+) workflow command target\(s\) validated; internal dependencies are not checked$/, (_, n) => `已校验 ${n} 个工作流命令目标；未检查内部依赖`],
  [/^(\d+) command reference\(s\) do not exist in the repository$/, (_, n) => `${n} 个命令引用在仓库中不存在`],
  [/^All (\d+) local command reference\(s\) exist(?:; (\d+) external reference\(s\) identified)?$/, (_, n, external) => `全部 ${n} 个本地命令引用存在${external ? `；已识别 ${external} 个外部引用` : ''}`],
  [/^All (\d+) command reference\(s\) exist$/, (_, n) => `全部 ${n} 个命令引用存在`],
  [/^(\d+) external command reference\(s\) identified$/, (_, n) => `已识别 ${n} 个外部命令引用`],
  [/^Fix missing paths: (.+)$/, (_, paths) => `修复缺失路径：${paths}`],
  [/^(\d+) minutes$/, (_, n) => `${n} 分钟`],
  [/^(\d+)\/(\d+) (?:cells )?matched$/, (_, n, total) => `${n}/${total} 项匹配`],
  [/^Reviewed real-data paper matrix: (\d+) pinned result cells\.$/, (_, n) => `已审查的真实数据论文矩阵：${n} 个固定结果单元格。`],
  [/^Reviewed real-data paper case\. Reference: (.+) in the pinned README\.$/, (_, value) => `已审查的真实数据论文案例。固定 README 中的参考值：${value}。`],
];

export function initialLanguage(storage, browserLanguage = 'en') {
  try {
    const saved = storage?.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* Storage can be disabled by the browser. */ }
  return /^zh\b/i.test(browserLanguage) ? 'zh' : 'en';
}

export function translate(value, language) {
  if (typeof value !== 'string') return value;
  if (language !== 'zh') {
    if (englishErrors[value]) return englishErrors[value];
    return value.replace(/^GitHub API 请求失败：(\d+)$/, 'GitHub API request failed: $1');
  }
  const key = value.trim();
  const translated = zh[key];
  if (translated !== undefined) return value.replace(key, () => translated);
  for (const [pattern, render] of messages) {
    const match = key.match(pattern);
    if (match) return value.replace(key, () => render(...match));
  }
  return value;
}
