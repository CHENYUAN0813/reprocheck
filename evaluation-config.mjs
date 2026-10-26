const cutoff = "(?:\\s*[@_-]?\\s*\\d+)?";
const metricNames = `accuracy|acc|precision${cutoff}|recall${cutoff}|f1(?:[-_ ]score)?${cutoff}|ndcg${cutoff}|mrr${cutoff}|map${cutoff}|hit(?:[-_ ]?rate)?${cutoff}|auc|mse|mae|rmse|loss|perplexity`;
const metricType = (label) => label.replaceAll("_", " ").match(new RegExp(`\\b(${metricNames})\\b`, "i"))?.[1]?.toLowerCase()
  .replace(/^acc$/, "accuracy").replace(/^f1(?:[-_ ]score)?/, "f1_score").replace(/\\s*[@_-]?\\s*(\\d+)$/, "_$1").replace(/[ -]+/g, "_");
const quote = (text) => `'${text.replaceAll("'", "'\"'\"'")}'`;

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
destination=(pathlib.Path("/workspace") / spec.get("path","reprocheck-evaluation.json")).resolve()
if not destination.is_relative_to(pathlib.Path("/workspace")): raise RuntimeError("Metric path resolves outside the repository")
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(json.dumps({spec["key"]:values[0],"entry":spec["command"],"capture":spec.get("kind","stdout"),"label":spec.get("label",spec["key"])},sort_keys=True,allow_nan=False))
print("candidate-evaluation-ok")`;

export function captureMetricCommand(command, capture, key, path) {
  if (capture.kind === "file") return command;
  if (key.includes(".")) throw new Error("Stdout capture needs a flat metric key; nested keys require native JSON output");
  const spec = { command, ...capture, key, path };
  const wrapped = `python -c ${quote(`exec(${JSON.stringify(stdoutAdapter)})`)} ${quote(JSON.stringify(spec))}`;
  if (wrapped.length > 6000) throw new Error("Evaluation capture exceeds the 6000-character command limit; use a shorter original entry");
  return wrapped;
}

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
