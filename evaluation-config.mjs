const metricNames = "accuracy|acc|precision|recall|f1(?:[-_ ]score)?|mse|mae|rmse|loss|perplexity";
const number = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?";
const metricKey = (label) => label.toLowerCase().replace(/[^\w]+/g, "_").replace(/^_|_$/g, "");
const tableMetric = (label) => label.replace(/[*`]/g, "").match(new RegExp(`^(?:(?:test|train(?:ing)?|validation|val|software|top[- ]?[15])\\s+)?(${metricNames})(?:\\s*\\(%\\))?$`, "i"))?.[1];
const metricType = (label) => label.replaceAll("_", " ").match(new RegExp(`\\b(${metricNames})\\b`, "i"))?.[1]?.toLowerCase().replace(/^acc$/, "accuracy").replace(/^f1(?:[-_ ]score)?$/, "f1_score");
const source = (file, line, text) => ({ file, line, text: text.trim().slice(0, 500) });
const quote = (text) => `'${text.replaceAll("'", "'\"'\"'")}'`;

// ponytail: bounded literal argparse declarations; dynamic parser construction/multi-value actions need a language parser.
function executionArguments(file) {
  return [...file.text.matchAll(/\.add_argument\(\s*((?:"[^"\n]*"|'[^'\n]*')[\s\S]{0,1200}?)\)\s*/g)].slice(0, 24).flatMap((match, index) => {
    const names = [...(match[1].match(/^\s*((?:["'][^"']+["']\s*,?\s*)+)/)?.[1] ?? "").matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
    const name = names.find((name) => name.startsWith("--")) ?? names[0];
    if (!name || !/^(?:--?)?[\w-]+$/.test(name)) return [];
    const positional = !name.startsWith("-");
    const nargs = match[1].match(/\bnargs\s*=\s*([^,\n]+)/)?.[1]?.trim().replace(/^["']|["']$/g, "");
    const action = match[1].match(/\baction\s*=\s*["']([^"']+)["']/)?.[1] ?? (/\baction\s*=/.test(match[1]) ? "dynamic" : "store");
    const rawDefault = match[1].match(/\bdefault\s*=\s*("[^"\n]*"|'[^'\n]*'|[-+]?\d+(?:\.\d+)?|True|False|None)(?=\s*[,\n]|\s*$)/)?.[1];
    const defaultValue = rawDefault && rawDefault !== "None" ? rawDefault.replace(/^["']|["']$/g, "") : null;
    return [{ id: `argument-${index + 1}`, name, aliases: names, positional, required: positional ? !["?", "*"].includes(nargs) : /\brequired\s*=\s*True\b/.test(match[1]),
      default: defaultValue, supported: action === "store" && (!nargs || nargs === "?"),
      help: match[1].match(/\bhelp\s*=\s*["']([^"']*)["']/)?.[1] ?? "",
      evidence: source(file.path, file.text.slice(0, match.index).split(/\r?\n/).length, match[0]) }];
  });
}

export function candidateCommand(entry, values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 24) throw new Error("Invalid candidate argument values");
  const args = entry.arguments ?? [];
  for (const [id, value] of Object.entries(values)) {
    if (!args.some((argument) => argument.id === id && argument.supported) || typeof value !== "string" || value.length > 240 || /[\r\n\0]/.test(value)) throw new Error("Unknown, unsupported or invalid candidate argument value");
  }
  const tokens = (entry.command.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? []).map((token) => token.replace(/^["']|["']$/g, ""));
  const script = tokens.findIndex((token) => /\.py$/.test(token));
  if (args.length && (script < 0 || tokens.slice(script + 1).some((token) => /^(?:&&|\|\||[;|<>])$/.test(token)))) throw new Error("Argument completion requires a simple Python script command; review complex commands manually");
  const tail = tokens.slice(script + 1);
  const positionals = [];
  for (let index = 0; index < tail.length; index += 1) {
    if (tail[index].startsWith("-")) {
      const option = args.find((argument) => argument.aliases.includes(tail[index].split("=")[0]));
      if (!tail[index].includes("=") && (!option || option.supported)) index += 1;
    } else positionals.push(tail[index]);
  }
  let positionalIndex = 0;
  const missing = [];
  const supplied = [];
  for (const argument of args) {
    const present = argument.positional ? positionalIndex++ < positionals.length
      : tail.some((token) => argument.aliases.some((alias) => token === alias || token.startsWith(`${alias}=`)));
    const value = values[argument.id]?.trim();
    if (value && present) throw new Error(`${argument.name} is already supplied by the source command; edit the reviewed command instead`);
    if (!present && value) supplied.push(`${argument.positional ? "" : `${argument.name} `}${quote(value)}`);
    if (!present && !value && argument.required) missing.push(argument.name);
  }
  return { command: [entry.command, ...supplied].join(" "), missing };
}

// ponytail: recognize literal labels/paths and flat Markdown tables, not arbitrary Python or paper semantics.
export function buildEvaluationDraft({ readme, readmeText, entrypoints, files, filePaths = files.map((file) => file.path) }) {
  const entries = entrypoints.filter((entry) => !["training", "preprocess", "demo"].includes(entry.category)
    && !/\bpython3?\s+-m\s+(?:venv|pip|pytest)\b/.test(entry.command));
  for (const file of files.filter(({ path, text }) => /(?:^|\/)(?:eval(?:uate)?|benchmark|main)[\w-]*\.py$/i.test(path)
    && /__main__|ArgumentParser/.test(text))) {
    if (!entries.some((entry) => entry.references.some((ref) => ref.path === file.path))) {
      entries.push({ id: `code-${entries.length + 1}`, category: "evaluation", command: `python ${quote(file.path)}`,
        evidence: source(file.path, 1, file.text.split(/\r?\n/)[0]), origin: "inferred-script",
        note: "Command inferred from script name; review working directory and required arguments",
        references: [{ path: file.path, exists: true }], parameters: [] });
    }
  }
  for (const entry of entries) entry.arguments = files.filter((file) => entry.references.some((ref) => ref.path === file.path) && /\.py$/i.test(file.path)).flatMap(executionArguments).slice(0, 24)
    .map((argument, index) => ({ ...argument, id: `argument-${index + 1}` }));
  const references = [];
  const lines = readmeText.split(/\r?\n/);
  let header = null;
  for (let index = 0; index < lines.length && references.length < 24; index += 1) {
    const line = lines[index];
    const cells = line.includes("|") ? line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()) : null;
    if (cells?.length === 2 && tableMetric(cells[0]) && /^[\d.+-]/.test(cells[1])) {
      const value = cells[1].match(new RegExp(`^(${number})\\s*(%)?$`, "i"));
      if (value && Number.isFinite(Number(value[1]))) references.push({ id: `reference-${index + 1}-1`, metricKey: metricKey(tableMetric(cells[0])), label: cells[0], value: Number(value[1]),
        unit: value[2] ? "percent" : "as printed (no conversion)", entryId: null, evidence: source(readme, index + 1, line), note: "Metric/value table candidate; dataset/model correspondence requires review" });
      continue;
    }
    if (cells && cells.some(tableMetric)) {
      header = cells; continue;
    }
    if (!cells) header = null;
    const associated = entries.filter((entry) => entry.evidence.file === readme && entry.evidence.line < index + 1
      && index + 1 - entry.evidence.line <= 24).sort((a, b) => b.evidence.line - a.evidence.line)[0];
    const add = (label, raw, percent, column, row = null, key = label) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      references.push({ id: `reference-${index + 1}-${column}`, metricKey: metricKey(key), value,
        unit: percent ? "percent" : "as printed (no conversion)", label: row ? `${row} · ${label}` : label,
        entryId: row ? null : associated?.id ?? null, evidence: source(readme, index + 1, line),
        note: "README report/example candidate, not independently verified paper or dataset/model correspondence" });
    };
    if (cells && header?.length === cells.length) {
      header.forEach((label, column) => {
        const clean = label.replace(/[*`]/g, "");
        const match = cells[column].replace(/[*`]/g, "").match(new RegExp(`^(${number})\\s*(%)?$`, "i"));
        const key = tableMetric(clean);
        if (key && match) add(clean, match[1], match[2] || /\(%\)/.test(clean), column, cells[0], key);
      });
    } else {
      for (const match of line.matchAll(new RegExp(`^[\\s*\x60]*(${metricNames})[\\s*\x60]*(?::|=|is)[\\s*\x60]*(${number})\\s*(%)?[\\s*\x60]*$`, "gi"))) {
        add(match[1], match[2], match[3], match.index);
      }
    }
  }
  const outputs = [];
  const contexts = [];
  const paths = [];
  for (const file of files) {
    const related = entries.filter((entry) => entry.references.some((ref) => ref.path === file.path));
    if (!related.length) continue;
    const codeLines = file.text.split(/\r?\n/);
    codeLines.forEach((line, index) => {
      const label = (line.match(new RegExp(`\\b(?:print|(?:logging|logger)\\.(?:info|warning|debug|error))\\(\\s*[f]?["']([^"'=:]*\\b(?:${metricNames})\\b[^"'=:]*?)\\s*[:=]`, "i"))?.[1]
        ?? line.match(new RegExp(`\\bprint\\(\\s*["']([^"']*\\b(?:${metricNames})\\b[^"']*)["']\\s*,`, "i"))?.[1])?.replace(/\\[tnr]/g, " ").trim();
      if (label && label.length <= 80) {
        outputs.push({ id: `stdout-${outputs.length + 1}`, kind: "stdout", label, metricKey: metricKey(label),
          unit: /%%|\}%|\d%/.test(line) ? "percent" : "as printed (no conversion)", entryIds: related.map((entry) => entry.id),
          evidence: source(file.path, index + 1, line), note: "Captures exactly one complete numeric labelled line; missing/duplicate values fail" });
      }
      if (/\bprint\(\s*json\.dumps\(/.test(line)) {
        for (const match of line.matchAll(new RegExp(`["'](${metricNames})["']\\s*:`, "gi"))) outputs.push({ id: `stdout-json-${outputs.length + 1}`, kind: "stdout-json", metricKey: metricKey(match[1]),
          unit: "as printed (no conversion)", entryIds: related.map((entry) => entry.id), evidence: source(file.path, index + 1, line), note: "One complete JSON-object metric line required; nested/dynamic keys need manual review" });
      }
      const path = line.match(/open\(\s*["']([^"']+\.(?:json|csv))["']\s*,\s*["'][wax]/)?.[1]
        ?? line.match(/\.to_csv\(\s*["']([^"']+\.csv)["']/)?.[1]
        ?? (/json\.dump|write_text/.test(file.text) ? line.match(/Path\(\s*["']([^"']+\.json)["']\s*\)/)?.[1] : null);
      if (path && !/^(?:\/|[A-Za-z]:)|(?:^|\/)\.\.(?:\/|$)/.test(path)) {
        const key = file.text.match(new RegExp(`["'](${metricNames})["']\\s*:`, "i"))?.[1];
        outputs.push({ id: `file-${outputs.length + 1}`, kind: path.endsWith(".csv") ? "csv" : "json", path, metricKey: key ? metricKey(key) : "",
          entryIds: related.map((entry) => entry.id), evidence: source(file.path, index + 1, line),
          note: "Literal result path candidate; confirm working directory/key; CSV requires exactly one data row" });
      }
      const dataset = line.match(/\b(load_(?:iris|wine|digits|breast_cancer|diabetes))\s*\(/)?.[1];
      const split = /\btrain_test_split\(/.test(line) ? codeLines.slice(index, index + 6).join(" ").match(/\btrain_test_split\(.{0,200}?\)/)?.[0] : null;
      const model = line.match(/\b([A-Za-z_]\w*(?:Classifier|Regression|KNN|MLP)|KNN|MLP)\([^\n]{0,100}\)/)?.[0];
      const checkpoint = line.match(/(?:torch\.load|lzma\.open|load_model)\(\s*["']([^"']+)["']/)?.[1];
      const config = !/\.py$/i.test(file.path) ? line.match(/^\s*["']?((?:data|dataset|model|checkpoint|weights)(?:[_-](?:path|file|name))?)["']?\s*[:=]\s*["']?([^"'\n#,}]+)["']?/) : null;
      if (config) contexts.push({ kind: /^(?:data|dataset)/.test(config[1]) ? "dataset" : "model", value: `Config declaration: ${config[1]}=${config[2].trim()}; review actual loader and split`,
        entryIds: related.map((entry) => entry.id), evidence: source(file.path, index + 1, line) });
      for (const match of line.matchAll(/["']([^"'\n]+\.(?:ya?ml|toml|jsonl?|csv|xlsx?|pt|pth|ckpt|pickle(?:\.lzma)?))["']/gi)) {
        if (/^[\\/]|[\r\n\0]|^(?:[A-Za-z]:|https?:)|(?:^|[\\/])\.\.(?:[\\/]|$)/.test(match[1])) continue;
        const exact = filePaths.includes(match[1]) ? match[1] : filePaths.filter((path) => path.endsWith(`/${match[1]}`));
        paths.push({ kind: /\.ya?ml$|\.toml$/.test(match[1]) ? "config" : /\.(?:pt|pth|ckpt|pickle)/.test(match[1]) ? "checkpoint" : "data-or-output",
          path: match[1], matches: typeof exact === "string" ? [exact] : exact, entryIds: related.map((entry) => entry.id), evidence: source(file.path, index + 1, line),
          note: "Literal path only; matches do not prove working-directory correctness or that an asset was prepared" });
      }
      if (dataset || model || checkpoint) contexts.push({ kind: dataset ? "dataset" : "model", entryIds: related.map((entry) => entry.id),
        value: dataset ? `Built-in sklearn ${dataset}; review original split in ${file.path}` : `Code candidate: ${checkpoint ?? model}; review original model/preparation in ${file.path}`,
        evidence: source(file.path, index + 1, line) });
      if (split) contexts.push({ kind: "split", entryIds: related.map((entry) => entry.id), value: split, evidence: source(file.path, index + 1, line) });
    });
  }
  return { status: entries.length ? "NEEDS_REVIEW" : "NO_EVALUATION_CANDIDATE", entries: entries.slice(0, 20), references, outputs: outputs.slice(0, 20), contexts: contexts.slice(0, 20),
    paths: paths.slice(0, 24), warnings: ["Candidates do not prove dataset/split/model equivalence or make repository code safe.",
      "Only sampled code and literal declarations are covered; missing information must be supplied, not invented."] };
}

const stdoutAdapter = `import json, math, pathlib, re, subprocess, sys
def unique_object(pairs):
    result={}
    for key,value in pairs:
        if key in result: raise RuntimeError("Duplicate JSON stdout fields are ambiguous")
        result[key]=value
    return result
spec=json.loads(sys.argv[1])
process=subprocess.Popen(["sh","-lc",spec["command"]],cwd="/workspace",stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
values=[]
size=0
for line in iter(lambda: process.stdout.readline(65537), ""):
    size+=len(line)
    if size>200000 or len(line)>65536: raise RuntimeError("Candidate stdout capture exceeded its bounded limit")
    print(line,end="",flush=True)
    if spec.get("kind")=="stdout-json":
        try: record=json.loads(line,object_pairs_hook=unique_object)
        except json.JSONDecodeError: continue
        if not isinstance(record,dict) or spec["key"] not in record: continue
        value=record[spec["key"]]
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value): raise RuntimeError("JSON stdout metric must be a finite number")
        values.append(value)
        continue
    clean=re.sub(r"\\x1b\\[[0-9;]*m","",line)
    match=re.fullmatch(r"\\s*(?:(?:INFO|DEBUG|WARNING|ERROR|CRITICAL):[\\w.-]+:)?"+re.escape(spec["label"])+r"(?:\\s*[:=]\\s*|\\s+)([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?)\\s*(%)?\\s*",clean)
    if match:
        if bool(match[2]) != (spec["unit"]=="percent"): raise RuntimeError("Observed metric unit differs from the reviewed candidate")
        values.append(float(match[1]))
if process.wait()!=0: raise RuntimeError("Original candidate entry exited with an error")
if len(values)!=1 or not math.isfinite(values[0]): raise RuntimeError("Expected exactly one finite labelled metric; missing or duplicate scores are ambiguous")
pathlib.Path("/workspace/reprocheck-evaluation.json").write_text(json.dumps({spec["key"]:values[0],"entry":spec["command"],"capture":spec.get("kind","stdout"),"label":spec.get("label",spec["key"])},sort_keys=True,allow_nan=False))
print("candidate-evaluation-ok")`;

export function candidateOptions(report, review) {
  const draft = report.evaluationDraft;
  const entry = draft?.entries.find((entry) => entry.id === review.entryId);
  const reference = review.referenceId ? draft?.references.find((ref) => ref.id === review.referenceId) : null;
  const output = review.outputId ? draft?.outputs.find((output) => output.id === review.outputId && output.entryIds.includes(review.entryId)) : null;
  if (!entry || (review.referenceId && !reference) || (review.outputId && !output)) throw new Error("Selected evaluation candidate no longer exists; scan and review again");
  const configured = candidateCommand(entry, review.argumentValues);
  if (configured.missing.length) throw new Error(`Required arguments need values: ${configured.missing.join(", ")}`);
  if (reference?.entryId && reference.entryId !== entry.id) throw new Error("The reference belongs to a different README command; choose its matching entry or supply a custom target");
  const stdout = ["stdout", "stdout-json"].includes(output?.kind);
  if (stdout && reference && reference.unit !== output.unit) throw new Error("Candidate metric units differ; values are not silently converted");
  if (output?.metricKey && reference && metricType(output.metricKey) !== metricType(reference.metricKey)) throw new Error("Candidate metric types differ; choose a corresponding reference or declare a custom target");
  // Only simple Python commands are wrapped; the original command is preserved verbatim apart from a copied prompt/repo cd.
  const repoName = report.repository.split("/").at(-1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const command = configured.command.replace(/^(?:[-*]\s+)?[$>]\s*/, "").replace(new RegExp(`^cd\\s+(?:\\./)?${repoName}\\s*&&\\s*`, "i"), "");
  if (stdout && !/^(?:(?:cd|pushd)\s+\S+\s*&&\s*)?python3?\s/.test(command)) throw new Error("Stdout candidate capture currently requires a reviewed Python command");
  const spec = stdout ? { command, kind: output.kind, ...(output.label ? { label: output.label } : {}), key: output.metricKey, unit: output.unit } : null;
  return { quickCommand: spec ? `python -c ${quote(`exec(${JSON.stringify(stdoutAdapter)})`)} ${quote(JSON.stringify(spec))}` : command,
    expectedText: spec ? "candidate-evaluation-ok" : "", outputFile: spec ? "reprocheck-evaluation.json" : output?.path ?? "",
    metricKey: output?.metricKey ?? reference?.metricKey ?? "", metricOperator: "eq", metricTarget: reference?.value ?? null, metricTolerance: 0,
    evaluation: { dataset: draft.contexts.find((context) => context.kind === "dataset" && context.entryIds.includes(entry.id))
      ? draft.contexts.filter((context) => ["dataset", "split"].includes(context.kind) && context.entryIds.includes(entry.id)).map((context) => context.value).join("; ").slice(0, 500)
        : report.reproductionPlan?.steps.find((step) => step.id === "data")?.instruction?.slice(0, 500) ?? "",
      model: draft.contexts.find((context) => context.kind === "model" && context.entryIds.includes(entry.id))?.value
        ?? report.reproductionPlan?.steps.find((step) => step.id === "model")?.instruction?.slice(0, 500) ?? "",
      reference: reference ? `https://github.com/${report.repository}/blob/${report.commit}/${reference.evidence.file}#L${reference.evidence.line}` : "", assetsInEntry: false },
    candidateReview: { ...review, confirmed: review.confirmed === true } };
}

export function reviewedCandidate(report, review, options) {
  if (!review.confirmed) throw new Error("Review and confirm the generated candidate configuration first");
  const proposed = candidateOptions(report, review);
  const draft = report.evaluationDraft;
  const entry = draft.entries.find((entry) => entry.id === review.entryId);
  const reference = draft.references.find((reference) => reference.id === review.referenceId) ?? null;
  const output = draft.outputs.find((output) => output.id === review.outputId) ?? null;
  const edits = Object.keys(proposed).filter((key) => key !== "candidateReview" && JSON.stringify(proposed[key]) !== JSON.stringify(options[key]));
  return { origin: "scan-generated, user-reviewed; not independently verified benchmark", repository: report.repository, commit: report.commit,
    entry, reference, output, argumentValues: review.argumentValues ?? {}, paths: (draft.paths ?? []).filter((path) => path.entryIds.includes(entry.id)), contexts: draft.contexts.filter((context) => context.entryIds.includes(entry.id)), edits,
    referenceConditionEdited: ["metricKey", "metricOperator", "metricTarget", "metricTolerance"].some((key) => options[key] !== proposed[key]) || options.evaluation?.reference !== proposed.evaluation.reference,
    warnings: draft.warnings };
}

export function candidateWorkflow(report, entry) {
  return { id: "evaluation", title: "Evaluation · selected scan candidate", status: "NEEDS_REVIEW", steps: [
    ...(report.reproductionPlan?.steps ?? []).filter((step) => ["environment", "install", "model", "data"].includes(step.id)),
    { id: "evaluation-candidate", title: "Reviewed scan-generated candidate entry", status: "DOCUMENTED", command: entry.command,
      evidence: entry.evidence, references: entry.references },
  ] };
}
