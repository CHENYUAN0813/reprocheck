import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import cpuEvaluationSource from "../examples/evaluate-micrograd.py?raw";
import { reviewedBenchmarks, reviewedTrainings, reviewedCaseById } from "../examples/reviewed-cases.mjs";
import publishedEvaluationSource from "../examples/evaluate-bthowen.py?raw";
import capacityEvaluationSource from "../examples/evaluate-capacity-probes.py?raw";
import trainingSource from "../examples/train-bthowen.py?raw";
import { candidateOptions, candidateWorkflow, suggestCandidate } from "../evaluation-config.mjs";
import { experimentDraft, experimentExecutionOptions, MODEL_EXPORT_LIMIT } from "../experiment-config.mjs";

const emptyAcceptance = { expectedText: "", outputFile: "", metricKey: "", metricOperator: "gte", metricTarget: "", metricTolerance: "0", dataset: "", model: "", reference: "", assetsInEntry: false };
const cpuEvaluationCommand = `python -c 'exec(${JSON.stringify(cpuEvaluationSource).replaceAll("'", "'\"'\"'")})'`;
const benchmarkSources = { bthowen: publishedEvaluationSource, "capacity-probes": capacityEvaluationSource };
const benchmarkEvaluationCommand = (benchmark) => `python -c 'exec(${JSON.stringify(benchmarkSources[benchmark.adapter]).replaceAll("'", "'\"'\"'")})' evaluate`;

const exampleParameters = [
  { name: "--epochs", default: "20", file: "train.py", line: 24 },
  { name: "--batch-size", default: "32", file: "train.py", line: 25 },
  { name: "--seed", default: "42", file: "train.py", line: 26 },
];

const exampleReport = {
  repository: "example-lab/vision-baseline",
  commit: "8f30db1c4d73e6d807923a3d2f4c2af06c7a1b91",
  filesScanned: 49,
  status: "NEEDS_WORK",
  summary: { failures: 0, warnings: 2 },
  checks: [
    {
      id: "readme",
      status: "PASS",
      message: "README found: README.md",
      evidence: { file: "README.md" },
      suggestion: null,
    },
    {
      id: "install_command",
      status: "PASS",
      message: "Install command found in README",
      evidence: {
        file: "README.md",
        line: 42,
        text: "pip install -r requirements.txt",
      },
      suggestion: null,
    },
    {
      id: "run_command",
      status: "PASS",
      message: "Run command found in README",
      evidence: {
        file: "README.md",
        line: 58,
        text: "python train.py --config configs/base.yaml",
      },
      suggestion: null,
    },
    {
      id: "data_instructions",
      status: "PASS",
      message: "Dataset instructions found in README",
      evidence: { file: "README.md", line: 73, text: "## Dataset preparation" },
      suggestion: null,
    },
    {
      id: "model_instructions",
      status: "PASS",
      message: "Model or checkpoint instructions found in README",
      evidence: { file: "README.md", line: 91, text: "Download pretrained weights" },
      suggestion: null,
    },
    {
      id: "dependencies",
      status: "PASS",
      message: "Dependencies found: requirements.txt",
      evidence: { file: "requirements.txt" },
      suggestion: null,
    },
    {
      id: "dependency_versions",
      status: "PASS",
      message: "All 12 dependencies are exactly pinned",
      evidence: { file: "requirements.txt" },
      suggestion: null,
    },
    {
      id: "license",
      status: "PASS",
      message: "License found: LICENSE",
      evidence: { file: "LICENSE" },
      suggestion: null,
    },
    {
      id: "tests",
      status: "WARN",
      message: "Test entry not found",
      evidence: null,
      suggestion: "Add a tests directory or Python test file",
    },
    {
      id: "python_version",
      status: "WARN",
      message: "Python version not clearly pinned",
      evidence: null,
      suggestion: "Pin Python with .python-version or runtime.txt",
    },
    {
      id: "random_seed",
      status: "PASS",
      message: "Random seed setup found in code",
      evidence: { file: "train.py", line: 18, text: "setup_seed(42)" },
      suggestion: null,
    },
    {
      id: "experiment_config",
      status: "PASS",
      message: "Reusable experiment configuration found",
      evidence: { file: "configs/base.yaml" },
      suggestion: null,
    },
    {
      id: "continuous_integration",
      status: "PASS",
      message: "Continuous integration found: .github/workflows/ci.yml",
      evidence: { file: ".github/workflows/ci.yml" },
      suggestion: null,
    },
    {
      id: "command_references",
      status: "PASS",
      message: "All 3 command reference(s) exist",
      evidence: { file: "requirements.txt" },
      suggestion: null,
    },
  ],
  experimentParameters: exampleParameters,
  reproductionPlan: {
    status: "INCOMPLETE",
    steps: [
      {
        id: "environment",
        title: "Prepare Python environment",
        status: "MISSING",
        instruction: null,
        evidence: null,
      },
      {
        id: "install",
        title: "Install dependencies",
        status: "DOCUMENTED",
        command: "pip install -r requirements.txt",
        evidence: { file: "README.md", line: 42 },
        references: [{ step: "install", path: "requirements.txt", exists: true }],
      },
      {
        id: "model",
        title: "Get model or checkpoint",
        status: "DOCUMENTED",
        instruction: "Download pretrained weights",
        evidence: { file: "README.md", line: 91 },
      },
      {
        id: "data",
        title: "Get and prepare dataset",
        status: "DOCUMENTED",
        instruction: "Download and prepare the dataset",
        evidence: { file: "README.md", line: 73 },
      },
      {
        id: "run",
        title: "Run the experiment",
        status: "DOCUMENTED",
        command: "python train.py --config configs/base.yaml",
        evidence: { file: "README.md", line: 58 },
        references: [
          { step: "run", path: "train.py", exists: true },
          { step: "run", path: "configs/base.yaml", exists: true },
        ],
        parameters: exampleParameters,
      },
    ],
  },
};

function EvidenceLink({ report, evidence }) {
  return (
    <a
      href={`https://github.com/${report.repository}/blob/${report.commit}/${evidence.file.split("/").map(encodeURIComponent).join("/")}${evidence.line ? `#L${evidence.line}` : ""}`}
      target="_blank"
      rel="noreferrer"
    >
      <code>
        {evidence.file}
        {evidence.line ? `:${evidence.line}` : ""}
      </code>
    </a>
  );
}

function downloadJson(data, filename) {
  const blobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

const visibleRunLog = (log) => log?.replace(/^::reprocheck-evidence::.*$/gm, "[Structured evidence captured; download execution evidence for complete data.]");

function PaperProvenance({ report }) {
  const provenance = report.paperProvenance;
  const workflow = report.paperWorkflowDraft;
  if (!provenance) return null;
  const draft = report.evaluationDraft;
  const entry = provenance.candidate && draft.entries.find((item) => item.id === provenance.candidate.entryId);
  const reference = provenance.candidate && draft.references.find((item) => item.id === provenance.candidate.referenceId);
  const output = provenance.candidate && draft.outputs.find((item) => item.id === provenance.candidate.outputId);
  return <section className="runner" aria-labelledby="paper-provenance-title">
    <div className="runner-heading"><div><p className="eyebrow">Paper provenance</p><h2 id="paper-provenance-title">Paper source and experiment claim</h2>
      <p>Source discovery only. A repository link does not prove that its code reproduces the paper.</p></div>
      <span className={`status status-${provenance.status.toLowerCase()}`}>{provenance.status.replaceAll("_", " ")}</span></div>
    {provenance.sources.length ? <div className="runner-result"><h3>Paper declarations and scholarly links</h3><ul>
      {provenance.sources.map((item) => <li key={item.id}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a> : item.label} · {item.provider} · <EvidenceLink report={report} evidence={item.evidence} /></li>)}
    </ul></div> : <p className="runner-note">No supported scholarly source was found in the README.</p>}
    {provenance.workflowHints?.length > 0 && <div className="runner-result"><h3>Documented paper workflow hints</h3><ul>
      {provenance.workflowHints.map((item) => <li key={item.id}><code>{item.command}</code> · <EvidenceLink report={report} evidence={item.evidence} /></li>)}
    </ul><p className="runner-note">These commands are evidence only until ReproCheck can safely associate their inputs and metric outputs.</p></div>}
    {workflow?.adapters.length > 0 && <div className="runner-result"><h3>Generated workflow adapters</h3>
      {workflow.adapters.map((adapter) => <details key={adapter.id}><summary>{adapter.title} · {adapter.status.replaceAll("_", " ")}</summary>
        <ol>{adapter.steps.map((step) => <li key={step.id}><strong>{step.role}</strong> · <code>{step.command}</code> · {step.supported ? "source target validated" : "blocked"}</li>)}</ol>
        {adapter.gaps.length > 0 && <p className="runner-note">Missing: {adapter.gaps.join("; ")}.</p>}
        <button className="download-button" type="button" onClick={() => downloadJson({ schemaVersion: 1, repository: report.repository, commit: report.commit,
          paperSourceId: provenance.candidate?.sourceId ?? (provenance.sources.length === 1 ? provenance.sources[0]?.id : null), adapter }, `reprocheck-paper-adapter-${adapter.id}.json`)}>Download adapter draft</button>
      </details>)}
      {workflow.warnings.map((warning) => <p className="runner-note" key={warning}>{warning}</p>)}
    </div>}
    {provenance.candidate && <div className="runner-result"><h3>Unconfirmed reproduction candidate</h3>
      <p><code>{entry.command}</code></p>
      <p className="hint">Metric: {output.metricKey} · README target: {reference.value} {reference.unit}.</p>
      <p className="runner-note">This pairing is source-backed and unique, but still requires protocol review and explicit confirmation below.</p>
    </div>}
    {provenance.gaps.length > 0 && <div className="runner-result"><h3>Still needed</h3><ul>{provenance.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}
  </section>;
}

function ProtocolLock({ report }) {
  const lock = report.protocolLock;
  if (!lock) return null;
  return <section className="runner" aria-labelledby="protocol-lock-title">
    <div className="runner-heading"><div><p className="eyebrow">Experiment identity</p><h2 id="protocol-lock-title">Protocol lock</h2>
      <p>Commit-pinned source, environment declarations, paper claims and asset identities.</p></div>
      <span className={`status status-${lock.status.toLowerCase()}`}>{lock.status.replaceAll("_", " ")}</span></div>
    <div className="runner-result"><dl className="evaluation-summary">
      <dt>Lock ID</dt><dd><code>{lock.lockId}</code></dd>
      <dt>Source files pinned</dt><dd>{lock.sourceFiles.length}</dd>
      <dt>Declared paths</dt><dd>{lock.declaredAssets.length}</dd>
      <dt>Python</dt><dd>{lock.environment.python?.value ?? "not exactly pinned"}</dd>
      <dt>Dependencies</dt><dd>{lock.environment.dependencies?.lockFile ? "lock file" : lock.environment.dependencyLocked ? "exact direct pins" : "not locked"}</dd>
    </dl></div>
    {lock.gaps.length > 0 && <div className="runner-result"><h3>Unresolved lock requirements</h3><ul>{lock.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}
    <details><summary>Source and asset identities</summary><pre className="evaluation-source">{JSON.stringify({ sourceFiles: lock.sourceFiles, declaredAssets: lock.declaredAssets,
      seedEvidence: lock.seedEvidence, parameters: lock.parameters }, null, 2)}</pre></details>
    {lock.warnings.map((warning) => <p className="runner-note" key={warning}>{warning}</p>)}
    <button className="download-button" type="button" onClick={() => downloadJson(lock, `reprocheck-protocol-lock-${report.commit.slice(0, 7)}.json`)}>Download protocol lock</button>
  </section>;
}

function CandidateConfig({ report, disabled, onApply }) {
  const draft = report.evaluationDraft;
  const suggested = draft.suggestion ?? suggestCandidate(report);
  function selections(entryId) {
    const related = draft.references.filter((reference) => reference.entryId === entryId);
    const outputs = draft.outputs.filter((output) => output.entryIds.includes(entryId));
    return { entryId, referenceId: related.length === 1 ? related[0].id : draft.references.length === 1 && (!draft.references[0].entryId || draft.references[0].entryId === entryId) ? draft.references[0].id : null,
      outputId: outputs.length === 1 ? outputs[0].id : null, confirmed: false };
  }
  const [review, setReview] = useState(() => suggested ?? selections(draft.entries[0]?.id ?? ""));
  let options;
  let failure;
  if (review.entryId) {
    try { options = candidateOptions(report, review); } catch (error) { failure = error.message; }
  }
  const entry = draft.entries.find((entry) => entry.id === review.entryId);
  const reference = draft.references.find((reference) => reference.id === review.referenceId);
  const output = draft.outputs.find((output) => output.id === review.outputId);
  const missing = options ? [!options.outputFile && "Result capture/output file", !options.metricKey && "Numeric metric key",
    options.metricTarget === null && "Reference value", !options.evaluation.dataset && "Dataset / split", !options.evaluation.model && "Model / checkpoint",
    !options.evaluation.reference && "Reference source"].filter(Boolean) : [];
  return <section className="runner candidate-config" aria-labelledby="candidate-title">
    <div className="runner-heading"><div><p className="eyebrow">Generated configuration · Needs review</p><h2 id="candidate-title">Build an Evaluation from this scan</h2>
      <p>Choose source-backed candidates, then review or complete the editable form. This does not execute code.</p></div></div>
    {suggested && <p className="runner-note">One unambiguous candidate was preselected from a matching README command, source metric and printed output. It is still unconfirmed.</p>}
    {draft.entries.length === 0 ? <p className="runner-note">No suitable entry candidate was found in the sampled files. Supply a custom Evaluation below; no command or benchmark is invented.</p> : <fieldset className="run-options" disabled={disabled}>
      <legend>Source-backed candidate choices</legend>
      <label>Candidate entry<select value={review.entryId} onChange={(event) => setReview(selections(event.target.value))}>
        {draft.entries.map((entry) => <option value={entry.id} key={entry.id}>{entry.command}{entry.origin ? " · inferred, review arguments" : ""}</option>)}
      </select></label>
      {entry && <p className="evidence"><span>Entry source</span><EvidenceLink report={report} evidence={entry.evidence} /></p>}
      {entry?.note && <p className="runner-note">{entry.note}</p>}
      {entry?.arguments?.length > 0 && <details open><summary>Execution arguments · review source and values</summary>
        {entry.arguments.map((argument) => <div key={argument.id}>
          <label>{argument.name}{argument.required ? " · required" : " · optional"}<input maxLength={240} disabled={!argument.supported}
            value={review.argumentValues?.[argument.id] ?? ""} placeholder={argument.default ?? "Already in command, or enter a reviewed value"}
            onChange={(event) => setReview((current) => ({ ...current, argumentValues: { ...current.argumentValues, [argument.id]: event.target.value } }))} /></label>
          <p className="hint">{argument.help}{!argument.supported && " · Complex action: supply a custom reviewed command instead."}</p>
          <p className="evidence"><span>Argument source</span><EvidenceLink report={report} evidence={argument.evidence} /></p>
        </div>)}
        <p className="hint">Blank preserves the original command/default. Values are shell-quoted, never executed while configuring.</p>
      </details>}
      {(draft.paths ?? []).some((path) => path.entryIds.includes(review.entryId)) && <details><summary>Configuration / data / checkpoint paths</summary>
        {(draft.paths ?? []).filter((path) => path.entryIds.includes(review.entryId)).map((path, index) => <p key={index} className="hint">{path.path} · {path.matches.length ? `Tree matches: ${path.matches.join(", ")}` : "Not found in tree; may need external preparation"} · <EvidenceLink report={report} evidence={path.evidence} /></p>)}
      </details>}
      <label>Result capture<select value={review.outputId ?? ""} onChange={(event) => setReview((current) => ({ ...current, outputId: event.target.value || null }))}>
        <option value="">Not selected — complete manually</option>
        {draft.outputs.filter((output) => output.entryIds.includes(review.entryId)).map((output) => <option value={output.id} key={output.id}>{output.kind === "stdout" ? `Labelled stdout: ${output.label} · ${output.unit}` : output.kind === "stdout-json" ? `JSON stdout: ${output.metricKey}` : `${output.kind.toUpperCase()}: ${output.path}`}</option>)}
      </select></label>
      {output && <p className="evidence"><span>Output source</span><EvidenceLink report={report} evidence={output.evidence} /></p>}
      <label>README reference candidate<select value={review.referenceId ?? ""} onChange={(event) => setReview((current) => ({ ...current, referenceId: event.target.value || null }))}>
        <option value="">Not selected — supply a declared target</option>
        {draft.references.filter((reference) => !reference.entryId || reference.entryId === review.entryId).map((reference) => <option value={reference.id} key={reference.id}>{reference.label}: {reference.value} · {reference.unit} · line {reference.evidence.line}</option>)}
      </select></label>
      {reference && <p className="evidence"><span>Reference source</span><EvidenceLink report={report} evidence={reference.evidence} /></p>}
      {failure && <p className="runner-error" role="alert">{failure}</p>}
      {options && <>
        <p className="hint">Proposed output: {options.outputFile || "missing"} · metric: {options.metricKey || "missing"} · reference: {options.metricTarget ?? "missing"} · tolerance: 0.</p>
        {missing.length > 0 && <p className="runner-note">Complete in the form: {missing.join("; ")}.</p>}
        {["stdout", "stdout-json"].includes(output?.kind) && <p className="hint">A generic adapter runs the original command and records its actual printed score as JSON. It never substitutes the reference value; missing/duplicate scores fail.</p>}
        <button type="button" onClick={() => onApply(options)}>Use candidates in Evaluation form</button>
      </>}
    </fieldset>}
    <details><summary>Candidate sources and coverage limits</summary><pre className="evaluation-source">{JSON.stringify(draft, null, 2)}</pre></details>
    <p className="runner-note">README values may be example output. You must confirm the selected dataset, split, model and metric correspond; they are not automatically verified paper claims.</p>
  </section>;
}

function ExperimentConfig({ report, disabled, onApply, onInvalidate }) {
  const [draft, setDraft] = useState(() => experimentDraft(report));
  const [error, setError] = useState("");
  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value, confirmed: key === "confirmed" ? value : false }));
    setError(""); onInvalidate();
  }
  async function importConfig(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setDraft((current) => ({ ...current, confirmed: false })); onInvalidate();
    try {
      if (file.size > 32000) throw new Error("Experiment configuration is limited to 32 KB");
      const config = JSON.parse(await file.text());
      const options = config.executionOptions;
      if (config.schemaVersion !== 1 || config.workflowId !== "training" || config.repository !== report.repository || config.commit !== report.commit
        || !options?.experiment || options.experiment.repository !== report.repository || options.experiment.commit !== report.commit || options.benchmarkId || options.candidateReview || options.evaluation?.assetsInEntry) throw new Error("Import requires a custom Training configuration matching this scanned repository/commit");
      const next = { ...options.experiment, evaluationCommand: options.quickCommand, outputFile: options.outputFile, metricKey: options.metricKey,
        metricOperator: options.metricOperator, metricTarget: options.metricTarget == null ? "" : String(options.metricTarget), metricTolerance: String(options.metricTolerance ?? 0),
        expectedText: options.expectedText ?? "", dataset: options.evaluation?.dataset ?? "", model: options.evaluation?.model ?? "", reference: options.evaluation?.reference ?? "" };
      experimentExecutionOptions({ ...next, confirmed: true });
      setDraft({ ...next, confirmed: false }); setError(""); onInvalidate();
    } catch (failure) { setError(failure.message); }
  }
  function apply(download = false) {
    try {
      const options = experimentExecutionOptions(draft);
      if (download) downloadJson({ schemaVersion: 1, repository: report.repository, commit: report.commit, workflowId: "training", executionOptions: options }, "reprocheck-experiment.json");
      else onApply(options);
      setError("");
    } catch (failure) { setError(failure.message); }
  }
  const fields = [
    ["title", "Experiment name"], ["installCommand", "Dependency installation · blank explicitly skips installation", 6000],
    ["prepareCommand", "Data preparation · blank means repository/built-in data or preparation inside trainer", 6000],
    ["trainCommand", "Original training command", 6000], ["checkpoint", "New model output path · relative to repository", 240],
    ["evaluationCommand", "Original evaluation command · must load that new model", 6000],
    ["parameters", "Training parameters · describe actual command/config, or not specified"], ["seed", "Actual seed policy · or not specified; this field does not set a seed"],
    ["protocol", "Protocol review · data split, model hand-off and known differences from reference"],
    ["dataset", "Dataset / held-out split"], ["model", "Model / training configuration"], ["reference", "Reference source · pinned source or explicitly user-defined target"],
    ["outputFile", "Evaluation score JSON / single-row CSV path", 240], ["metricKey", "Metric key / CSV column", 100],
  ];
  return <fieldset className="run-options" disabled={disabled}>
    <legend>End-to-end experiment · prepare → train → new model → evaluate</legend>
    <p className="hint">Scan-prefilled candidates require review. All commands start at the repository root in the same temporary container; use cd … &amp;&amp; where needed. Import only loads fields, never runs code.</p>
    <label>Import saved experiment configuration<input type="file" accept=".json,application/json" onChange={importConfig} /></label>
    {fields.map(([key, label, limit = 500]) => <label key={key}>{label}<input value={draft[key]} maxLength={limit} onChange={(event) => update(key, event.target.value)} /></label>)}
    <label>Evaluation metric capture<select value={draft.capture.kind} onChange={(event) => update("capture", { ...draft.capture, kind: event.target.value })}>
      <option value="file">Original JSON / single-row CSV output</option><option value="stdout">One labelled numeric stdout line</option><option value="stdout-json">One JSON-object stdout metric line</option>
    </select></label>
    {draft.capture.kind === "stdout" && <label>Exact stdout label<input value={draft.capture.label} maxLength={80} placeholder="Accuracy" onChange={(event) => update("capture", { ...draft.capture, label: event.target.value })} /></label>}
    <label>Printed metric units<select value={draft.capture.unit} onChange={(event) => update("capture", { ...draft.capture, unit: event.target.value })}>
      <option value="number">Number as printed · no conversion</option><option value="percent">Percent with % suffix</option>
    </select></label>
    <div className="metric-options">
      <label>Condition<select value={draft.metricOperator} onChange={(event) => update("metricOperator", event.target.value)}><option value="eq">Match reference (±)</option><option value="gte">At least (≥)</option><option value="lte">At most (≤)</option></select></label>
      <label>Reference value<input type="number" step="any" value={draft.metricTarget} onChange={(event) => update("metricTarget", event.target.value)} /></label>
      {draft.metricOperator === "eq" && <label>Absolute tolerance<input type="number" min="0" step="any" value={draft.metricTolerance} onChange={(event) => update("metricTolerance", event.target.value)} /></label>}
    </div>
    <p className="runner-note">Requires an absent-before-training model file up to {MODEL_EXPORT_LIMIT / 1024} KiB. The evaluator must use this file; hashes only show bytes, not prove model use or scientific protocol equivalence. No pretrained fallback, host data upload, GPU or arbitrary paper-protocol inference.</p>
    <details><summary>Scanned training/evaluation sources and parameters</summary><pre>{JSON.stringify({ training: report.evaluationDraft?.trainingEntries, evaluation: report.evaluationDraft?.entries,
      paths: report.evaluationDraft?.paths, parameters: report.experimentParameters, warnings: report.evaluationDraft?.warnings }, null, 2)}</pre></details>
    <label className="runner-confirm"><input type="checkbox" checked={draft.confirmed} onChange={(event) => update("confirmed", event.target.checked)} />I reviewed every stage, data/split, training parameters/seed, model hand-off and reference. Blank installation/preparation is deliberate. Edits require confirmation again.</label>
    {error && <p className="runner-error" role="alert">{error}</p>}
    <div className="recipe-actions"><button type="button" onClick={() => apply()} disabled={!draft.confirmed}>Apply reviewed experiment</button>
      <button type="button" className="download-button" onClick={() => apply(true)} disabled={!draft.confirmed}>Download experiment configuration</button></div>
  </fieldset>;
}

function ExecutionEvidence({ job, onPrepareReplay, replayDisabled }) {
  const labels = { VERIFIED: "Configured checks passed", FAILED: "Output checks failed", INCOMPLETE: "Verification incomplete",
    NOT_CONFIGURED: "No output checks configured", PENDING: "Waiting for execution" };
  return (
    <div className="execution-evidence">
      <h3>Output verification · {labels[job.verification?.status] ?? "Not available"}</h3>
      <p className="hint">Execution success alone does not prove paper reproducibility. These checks validate only the expectations you supplied.</p>
      {job.persistenceError && <p className="runner-error" role="alert">{job.persistenceError} — download the evidence now.</p>}
      {job.logTruncated && <p className="runner-note">Only the last 900,000 log characters are retained.</p>}
      <ul className="verification-checks">
        {job.verification?.checks?.map((check) => (
          <li key={check.id}><strong>{check.status}</strong> · {check.id}: <code>{check.expected}</code>
            {check.observed && <pre>{JSON.stringify(check.observed, null, 2)}</pre>}
          </li>
        ))}
      </ul>
      {job.evaluation && <div className="run-comparison">
        <h3>Evaluation report · {job.evaluation.status.replaceAll("_", " ")}</h3>
        <p className="hint">{job.benchmark ? `Reviewed ${job.benchmark.datasetName} software case: input hashes and the pinned README row must pass checks before entry and at completion. This is not full-paper reproduction or a security attestation.` : "Dataset, model and reference source below are user declarations, not independently verified paper claims."}</p>
        <dl className="evaluation-summary">
          <dt>Dataset / split</dt><dd>{job.evaluation.dataset}</dd>
          <dt>Model / checkpoint</dt><dd>{job.evaluation.model}</dd>
          <dt>Reference source</dt><dd>{job.benchmark ? <a href={job.benchmark.reference.url} target="_blank" rel="noreferrer">Pinned README · Table 3 · {job.benchmark.datasetName}</a> : job.evaluation.reference}</dd>
          <dt>Observed / reference</dt><dd>{job.evaluation.observedValue ?? "unknown"} / {job.evaluation.referenceValue} · {job.evaluation.metricKey}</dd>
          <dt>Difference / tolerance</dt><dd>{Number.isFinite(job.evaluation.delta) ? Number(job.evaluation.delta.toPrecision(12)) : "unknown"} / {job.evaluation.tolerance} · condition {job.evaluation.operator}</dd>
        </dl>
        {job.benchmark && <>
          <p className="runner-note">{job.benchmark.compatibility.note}</p>
          <p className="hint">Scope: {job.benchmark.reference.scope}</p>
          <details><summary>Dataset, checkpoint, code hashes and reference-row evidence</summary><pre>{JSON.stringify({ assets: job.assets, reference: job.referenceEvidence }, null, 2)}</pre></details>
        </>}
        {job.benchmark?.training && <>
          <h3>Training from scratch</h3>
          <p className="hint">Original repository trainer → newly saved model → original evaluator. No pretrained model fallback and no search for a better test score.</p>
          <dl className="evaluation-summary">
            <dt>Paper configuration</dt><dd>{JSON.stringify(job.benchmark.training.parameters)}</dd>
            <dt>Run seed / count</dt><dd>{job.benchmark.training.seed} / 1 · our disclosed seed, not an author-provided seed</dd>
            <dt>Training time</dt><dd>{job.trainingCheckpoint?.trainingSeconds ?? "unknown"} seconds</dd>
            <dt>New checkpoint</dt><dd>{job.trainingCheckpoint?.path ?? "not saved"} · {job.trainingCheckpoint?.size ?? 0} bytes</dd>
            <dt>Checkpoint SHA-256</dt><dd>{job.trainingCheckpoint?.sha256 ?? "unknown"}</dd>
          </dl>
          {job.trainingCheckpoint?.status === "PASSED" && job.trainingCheckpoint.base64 && <a className="download-button evidence-download"
            href={`data:application/octet-stream;base64,${job.trainingCheckpoint.base64}`} download={`reprocheck-iris-${job.id}.pickle.lzma`}>Download newly trained model</a>}
          <p className="runner-note">Pickle models are executable when loaded. This download is data only; do not load an untrusted model on the host.</p>
        </>}
        {job.experiment && <>
          <h3>Configured end-to-end experiment</h3>
          <dl className="evaluation-summary"><dt>Parameters / seed (declared)</dt><dd>{job.experiment.parameters} / {job.experiment.seed}</dd>
            <dt>Protocol review (declared)</dt><dd>{job.experiment.protocol}</dd><dt>New checkpoint</dt><dd>{job.trainingCheckpoint?.path ?? "not saved"} · {job.trainingCheckpoint?.size ?? 0} bytes</dd>
            <dt>Checkpoint SHA-256</dt><dd>{job.trainingCheckpoint?.sha256 ?? "unknown"}</dd><dt>Training time</dt><dd>{job.trainingCheckpoint?.trainingSeconds ?? "unknown"} seconds</dd></dl>
          {job.trainingCheckpoint?.status === "PASSED" && job.trainingCheckpoint.base64 && <a className="download-button evidence-download"
            href={`data:application/octet-stream;base64,${job.trainingCheckpoint.base64}`} download={job.trainingCheckpoint.path.split("/").at(-1)}>Download newly trained model</a>}
          <p className="runner-note">Model downloads are untrusted data. Never load pickle/joblib or other executable model formats on the host. A matching number does not independently verify the declared protocol.</p>
        </>}
        {job.evaluation.output && <details><summary>Reported metrics and asset identifiers</summary><pre>{JSON.stringify(job.evaluation.output, null, 2)}</pre></details>}
      </div>}
      {job.candidate && <details><summary>Reviewed scan candidates and manual changes</summary><pre>{JSON.stringify(job.candidate, null, 2)}</pre></details>}
      <details>
        <summary>Environment and actual commands</summary>
        <pre>{JSON.stringify({ environment: job.environment, limits: job.limits, commandOverride: job.commandOverride,
          commands: job.steps, dependencies: job.dependencies, experimentParameters: job.experimentParameters,
          note: "Extracted parameter defaults are not proof of the values or seeds actually used." }, null, 2)}</pre>
      </details>
      {job.status !== "RUNNING" && (
        <a className="download-button evidence-download" href={`/api/runs/${job.id}?download=1`} download={`reprocheck-run-${job.id}.json`}>Download execution evidence</a>
      )}
      {job.recipe && <div className="recipe-actions">
        <a className="download-button evidence-download" href={`/api/runs/${job.id}/recipe?download=1`} download={`reprocheck-recipe-${job.id}.json`}>Download frozen recipe</a>
        <button type="button" onClick={() => onPrepareReplay(job.id)} disabled={replayDisabled}>Review frozen recipe</button>
      </div>}
      {!job.recipe && job.status === "SUCCEEDED" && <p className="runner-note">Recipe unavailable: {job.recipeUnavailableReason ?? "This record predates recipe capture; run again."}</p>}
      {job.comparison && <div className="run-comparison">
        <h3>Compared with baseline · {job.comparison.status}</h3>
        <p className="hint">Baseline {job.comparison.baselineRunId}. Exact observed comparison, not proof of paper reproduction or full stdout equality.</p>
        <ul className="verification-checks">
          {job.comparison.rows.map((row) => <li key={row.id}>
            <strong>{row.status}</strong> · {row.id}{row.key && ` (${row.key})`}{row.delta !== undefined && ` · delta: ${row.delta ?? "unknown"}`}
            <details><summary>Baseline / replay values</summary><pre>{JSON.stringify({ baseline: row.baseline, replay: row.current }, null, 2)}</pre></details>
          </li>)}
        </ul>
      </div>}
    </div>
  );
}

function App() {
  const [url, setUrl] = useState("");
  const [report, setReport] = useState(exampleReport);
  const [isExample, setIsExample] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState("quick");
  const [preflight, setPreflight] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [runConfirmed, setRunConfirmed] = useState(false);
  const [runJob, setRunJob] = useState(null);
  const [runLoading, setRunLoading] = useState(false);
  const optionsLocked = preflightLoading || runLoading || runJob?.status === "RUNNING";
  const [quickCommand, setQuickCommand] = useState("");
  const [acceptance, setAcceptance] = useState(emptyAcceptance);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [archivedJob, setArchivedJob] = useState(null);
  const [replayPreview, setReplayPreview] = useState(null);
  const [replayConfirmed, setReplayConfirmed] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState("");
  const executionBusy = loading || preflightLoading || runLoading || replayLoading || runJob?.status === "RUNNING";
  useEffect(() => { if (replayPreview) document.getElementById("recipe-title")?.focus(); }, [replayPreview]);
  useEffect(() => { if (runJob?.id) document.getElementById("current-execution")?.focus(); }, [runJob?.id]);
  async function prepareReplay(id) {
    setReplayLoading(true);
    setReplayError("");
    setReplayConfirmed(false);
    setReplayPreview(null);
    try {
      const response = await fetch(`/api/runs/${id}/replay-preflight`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to prepare the recipe");
      setReplayPreview(result);
    } catch (failure) { setReplayError(failure.message); }
    finally { setReplayLoading(false); }
  }
  async function startReplay() {
    setRunLoading(true);
    setReplayError("");
    try {
      const response = await fetch(`/api/runs/${replayPreview.replayOf}/replay`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmUnknownCode: true, recipeFingerprint: replayPreview.recipe.fingerprint }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start replay");
      setRunJob(result);
      setReplayConfirmed(false);
      setRunConfirmed(false);
    } catch (failure) { setReplayError(failure.message); }
    finally { setRunLoading(false); }
  }
  async function refreshHistory() {
    try {
      const response = await fetch("/api/runs");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load history");
      setHistory(result.runs);
      setHistoryError("");
    } catch (historyFailure) { setHistoryError(historyFailure.message); }
  }
  async function openHistory(id) {
    try {
      const response = await fetch(`/api/runs/${id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load the record");
      setArchivedJob(result);
      setHistoryError("");
    } catch (historyFailure) { setHistoryError(historyFailure.message); }
  }
  useEffect(() => { if (runJob?.status !== "RUNNING") void refreshHistory(); }, [runJob?.status]);
  function updateAcceptance(field, value) {
    setAcceptance((current) => ({ ...current, [field]: value, ...(field !== "candidateReview" && current.candidateReview
      ? { candidateReview: { ...current.candidateReview, confirmed: false } } : {}) }));
    setPreflight(null);
    setRunConfirmed(false);
  }
  const activeWorkflow = report.workflows?.find((workflow) => workflow.id === selectedWorkflow)
    ?? report.workflows?.[0]
    ?? null;
  const selectedCandidate = report.evaluationDraft?.entries.find((entry) => entry.id === acceptance.candidateReview?.entryId);
  const selectedReviewedCase = acceptance.benchmarkId ? reviewedCaseById.get(acceptance.benchmarkId) : null;
  const selectedBenchmarkSource = selectedReviewedCase ? benchmarkSources[selectedReviewedCase.adapter] : null;
  const displayedPlan = acceptance.experiment ? { title: acceptance.experiment.title, status: "USER_REVIEWED_EXPERIMENT", steps: [
    ...(acceptance.experiment.installCommand ? [{ id: "install", title: "Install reviewed dependencies", status: "USER_REVIEWED", command: acceptance.experiment.installCommand }] : []),
    ...(acceptance.experiment.prepareCommand ? [{ id: "prepare-data", title: "Prepare data", status: "USER_REVIEWED", command: acceptance.experiment.prepareCommand }] : []),
    { id: "train", title: "Train and save new model", status: "USER_REVIEWED", command: acceptance.experiment.trainCommand },
    { id: "evaluate", title: "Evaluate new model", status: "USER_REVIEWED", command: quickCommand },
  ] } : selectedReviewedCase?.training ? { title: selectedReviewedCase.title, status: "REVIEWED_TRAINING", steps: [
    { id: "install", title: "Install reviewed CPU dependencies", status: "DOCUMENTED", command: selectedReviewedCase.installCommand },
    { id: "prepare-assets", title: `Prepare hash-locked real UCI ${selectedReviewedCase.datasetName} data`, status: "DOCUMENTED", instruction: "Reviewed adapter downloads UCI data and applies the explicit MNIST-only import compatibility patch. Check the local runner for exact commands." },
    { id: "training-benchmark", title: "Train from scratch and save a new model", status: "DOCUMENTED", command: `cd software_model && python train_swept_models.py ${selectedReviewedCase.training.arguments.join(" ")}`, instruction: `Reviewed launcher sets NumPy seed ${selectedReviewedCase.training.seed} before calling the original trainer. This is the original invocation, not the complete seeded adapter.` },
    { id: "evaluation-benchmark", title: `Evaluate the newly trained model and compare with ${selectedReviewedCase.reference.value}`, status: "DOCUMENTED", instruction: "Original evaluate.py reads the newly trained checkpoint; the adapter records actual held-out accuracy as JSON." },
  ] } : selectedCandidate ? candidateWorkflow(report, selectedCandidate) : activeWorkflow ?? report.reproductionPlan;

  function applyCandidate(options) {
    setSelectedWorkflow("evaluation");
    setQuickCommand(options.quickCommand);
    setAcceptance({ ...emptyAcceptance, ...options.evaluation, expectedText: options.expectedText, outputFile: options.outputFile,
      metricKey: options.metricKey, metricOperator: options.metricOperator, metricTarget: options.metricTarget === null ? "" : String(options.metricTarget),
      candidateReview: options.candidateReview });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
    document.getElementById("runner-title")?.focus();
  }

  function applyExperiment(options) {
    setSelectedWorkflow("training"); setQuickCommand(options.quickCommand);
    setAcceptance({ ...emptyAcceptance, ...options.evaluation, experiment: options.experiment, outputFile: options.outputFile, metricKey: options.metricKey,
      metricOperator: options.metricOperator, metricTarget: String(options.metricTarget), metricTolerance: String(options.metricTolerance), expectedText: options.expectedText });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
  }

  function invalidateExperiment() {
    setAcceptance((current) => ({ ...current, experiment: null }));
    setPreflight(null); setRunConfirmed(false);
  }

  const runScan = useCallback(async (targetUrl, benchmarkId) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, ...(benchmarkId ? { executionOptions: { benchmarkId } } : {}) }),
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.error || "Scan failed");

      setReport(result);
      setIsExample(false);
      setSelectedWorkflow("quick");
      setPreflight(null);
      setRunConfirmed(false);
      setRunJob(null);
      setQuickCommand("");
      setAcceptance(emptyAcceptance);
      return result;
    } catch (scanError) {
      setError(scanError.message || "Unable to scan this repository");
      throw scanError;
    } finally {
      setLoading(false);
    }
  }, []);

  function submit(event) {
    event.preventDefault();
    void runScan(url).catch(() => {});
  }

  async function loadCpuEvaluation() {
    const targetUrl = "https://github.com/karpathy/micrograd";
    setUrl(targetUrl);
    try {
      await runScan(targetUrl);
      setSelectedWorkflow("evaluation");
      setQuickCommand(cpuEvaluationCommand);
      setAcceptance({ ...emptyAcceptance, expectedText: "evaluation-ok", outputFile: "evaluation-result.json", metricKey: "accuracy", metricOperator: "eq", metricTarget: "1", metricTolerance: "0.05",
        dataset: "Synthetic separated-sign-x-v1; train 32 (seed 101), held-out test 48 (seed 202); generated and hashed in entry",
        model: "Micrograd MLP [2,4,1]; seed 7, SGD 40 epochs, lr 0.1; checkpoint saved and reloaded in entry",
        reference: "ReproCheck synthetic fixture target: accuracy 1.0 ± 0.05; NOT Micrograd moon data or a published benchmark", assetsInEntry: true });
    } catch { /* The scan error is already displayed. */ }
  }

  async function loadPublishedBenchmark(benchmarkId) {
    const benchmark = reviewedCaseById.get(benchmarkId);
    const targetUrl = `https://github.com/${benchmark.repository}`;
    setUrl(targetUrl);
    try {
      await runScan(targetUrl, benchmark.id);
      setSelectedWorkflow(benchmark.training ? "training" : "evaluation");
      setQuickCommand(benchmarkEvaluationCommand(benchmark));
      setAcceptance({ ...emptyAcceptance, benchmarkId: benchmark.id, expectedText: "published-benchmark-ok", outputFile: "benchmark-result.json",
        metricKey: benchmark.metricKey ?? "accuracy", metricOperator: "eq", metricTarget: String(benchmark.reference.value), metricTolerance: String(benchmark.reference.tolerance),
        dataset: benchmark.dataset, model: benchmark.model, reference: benchmark.reference.url });
    } catch { /* The scan error is already displayed. */ }
  }

  function downloadReport() {
    downloadJson(
      report,
      `reprocheck-${report.repository.replace("/", "-")}-${report.commit.slice(0, 7)}.json`,
    );
  }

  function downloadPlan() {
    downloadJson(
      {
        repository: report.repository,
        commit: report.commit,
        ...displayedPlan,
        experimentParameters: report.experimentParameters,
      },
      `reprocheck-plan-${report.repository.replace("/", "-")}-${report.commit.slice(0, 7)}.json`,
    );
  }

  async function checkPreflight() {
    setPreflightLoading(true);
    setPreflightError("");
    setRunConfirmed(false);
    setRunJob(null);

    try {
      const response = await fetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${report.repository}`,
          commit: report.commit,
          workflowId: activeWorkflow.id,
          executionOptions: acceptance.benchmarkId ? { benchmarkId: acceptance.benchmarkId } : { quickCommand, expectedText: acceptance.expectedText, outputFile: acceptance.outputFile, metricKey: acceptance.metricKey,
            metricOperator: acceptance.metricOperator, metricTarget: acceptance.metricTarget === "" ? null : Number(acceptance.metricTarget), metricTolerance: acceptance.metricOperator === "eq" ? Number(acceptance.metricTolerance) : 0,
            ...(acceptance.candidateReview ? { candidateReview: acceptance.candidateReview } : {}),
            ...(acceptance.experiment ? { experiment: acceptance.experiment } : {}),
            evaluation: activeWorkflow.id === "evaluation" || acceptance.experiment ? { dataset: acceptance.dataset, model: acceptance.model, reference: acceptance.reference, assetsInEntry: acceptance.assetsInEntry } : null },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Runner check failed");
      setPreflight(result);
    } catch (runnerError) {
      setPreflightError(runnerError.message || "Unable to check the runner");
    } finally {
      setPreflightLoading(false);
    }
  }

  async function startExecution(packageIndex = "readme", previousJob = null) {
    setRunLoading(true);
    setPreflightError("");

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${previousJob?.repository ?? report.repository}`,
          commit: previousJob?.commit ?? report.commit,
          workflowId: previousJob?.workflowId ?? activeWorkflow.id,
          packageIndex,
          executionOptions: previousJob?.executionOptions ?? preflight.executionOptions,
          confirmUnknownCode: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start the run");
      setRunJob(result);
    } catch (runError) {
      setPreflightError(runError.message || "Unable to start the run");
    } finally {
      setRunLoading(false);
    }
  }

  async function cancelExecution() {
    const response = await fetch(`/api/runs/${runJob.id}`, { method: "DELETE" });
    const result = await response.json();
    if (response.ok) setRunJob(result);
  }

  useEffect(() => {
    if (runJob?.status !== "RUNNING") return undefined;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/runs/${runJob.id}`);
        const result = await response.json();
        if (response.ok) {
          setRunJob(result);
        } else if (response.status === 404) {
          setRunJob((current) => ({
            ...current,
            status: "LOST",
            diagnosis: "The local server restarted and lost this run record; the container still has its own timeout.",
          }));
        }
      } catch {
        // Keep the current log visible while a transient poll fails.
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [runJob?.id, runJob?.status]);

  useEffect(() => {
    const context = document.modelContext;

    if (!context?.registerTool) return undefined;

    const lifecycle = new AbortController();

    void Promise.resolve(
      context.registerTool(
        {
          name: "scan_repository",
          title: "Scan repository",
          description: "Scan a public GitHub research repository and show its reproducibility report.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", format: "uri" },
            },
            required: ["url"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          async execute(input) {
            if (typeof input?.url !== "string") {
              throw new Error("A GitHub repository URL is required");
            }

            setUrl(input.url);
            const result = await runScan(input.url);
            return {
              repository: result.repository,
              status: result.status,
              summary: result.summary,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});

    return () => lifecycle.abort();
  }, [runScan]);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ReproCheck home">
          <span className="brand-mark">R</span>
          <span>ReproCheck</span>
        </a>
        <span className="mode">Static audit</span>
      </header>

      <main>
        <section className="scan-panel" aria-labelledby="scan-title">
          <div>
            <p className="eyebrow">Research repository readiness</p>
            <h1 id="scan-title">Find blockers before you run the code.</h1>
          </div>

          <form onSubmit={submit}>
            <label htmlFor="repository">Public GitHub repository</label>
            <div className="input-row">
              <input
                id="repository"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                required
              />
              <button type="submit" disabled={executionBusy}>
                {loading ? "Scanning…" : "Scan repository"}
              </button>
            </div>
            <p className="hint">Public repositories only · Results pinned to a commit</p>
            <button className="download-button" type="button" onClick={loadCpuEvaluation} disabled={executionBusy}>Load CPU evaluation example</button>
            <p className="hint">Small synthetic held-out dataset + trained checkpoint. Loads a reviewed command; does not start execution.</p>
            {reviewedBenchmarks.map((benchmark) => <div key={benchmark.id}>
              <button className="download-button" type="button" onClick={() => loadPublishedBenchmark(benchmark.id)} disabled={executionBusy}>Load published {benchmark.datasetName} benchmark</button>
              <p className="hint">Reviewed real-data paper case + original repository entry. Reference: {benchmark.reference.value} in the pinned README. Does not start execution.</p>
            </div>)}
            {reviewedTrainings.map((benchmark) => <div key={benchmark.id}>
              <button className="download-button" type="button" onClick={() => loadPublishedBenchmark(benchmark.id)} disabled={executionBusy}>Load {benchmark.datasetName} training reproduction</button>
              <p className="hint">Train the original paper model once, save a new checkpoint, then evaluate against {benchmark.reference.value}. The reference is a comparison, not a promised result.</p>
            </div>)}
          </form>

          {error && <p className="error" role="alert">{error}</p>}
        </section>

        <section className="report" aria-labelledby="report-title">
          <div className="report-heading">
            <div>
              <div className="report-label">
                <span>{isExample ? "Example report" : "Scan report"}</span>
                <span className={`status status-${report.status.toLowerCase()}`}>
                  {report.status.replaceAll("_", " ")}
                </span>
              </div>
              <h2 id="report-title">{report.repository}</h2>
              <p className="commit">Commit {report.commit}</p>
            </div>

            <div className="report-tools">
              <dl className="summary">
                <div>
                  <dt>Files</dt>
                  <dd>{report.filesScanned}</dd>
                </div>
                <div>
                  <dt>Blockers</dt>
                  <dd>{report.summary.failures}</dd>
                </div>
                <div>
                  <dt>Warnings</dt>
                  <dd>{report.summary.warnings}</dd>
                </div>
              </dl>
              {!isExample && (
                <button className="download-button" type="button" onClick={downloadReport}>
                  Download JSON
                </button>
              )}
            </div>
          </div>

          <div className="checks">
            {report.checks.map((check) => (
              <article className={`check check-${check.status.toLowerCase()}`} key={check.id}>
                <div className="check-main">
                  <span className="check-status">{check.status}</span>
                  <div>
                    <h3>{check.message}</h3>
                    {check.evidence && (
                      <p className="evidence">
                        <span>Evidence</span>
                        <EvidenceLink report={report} evidence={check.evidence} />
                      </p>
                    )}
                  </div>
                </div>

                {check.evidence?.text && <code className="command">{check.evidence.text}</code>}
                {check.suggestion && <p className="suggestion"><span>Fix</span>{check.suggestion}</p>}
              </article>
            ))}
          </div>
        </section>

        {!isExample && <PaperProvenance report={report} />}
        {!isExample && <ProtocolLock report={report} />}

        {displayedPlan && (
          <section className="plan" aria-labelledby="plan-title">
            <div className="plan-heading">
              <div>
                <p className="eyebrow">
                  {report.workflows ? "Reproduction workflows" : "Reproduction plan"}
                </p>
                <h2 id="plan-title">
                  {displayedPlan.title ?? activeWorkflow?.title ?? "From repository to first run"}
                </h2>
                {report.workflows && (
                  <div className="workflow-tabs" role="tablist" aria-label="Reproduction workflow">
                    {report.workflows.map((workflow) => (
                      <button
                        className={`workflow-tab${workflow.id === activeWorkflow?.id ? " workflow-tab-active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={workflow.id === activeWorkflow?.id}
                        disabled={executionBusy}
                        onClick={() => {
                          setSelectedWorkflow(workflow.id);
                          setPreflight(null);
                          setRunConfirmed(false);
                          setRunJob(null);
                          setQuickCommand("");
                          setAcceptance(emptyAcceptance);
                        }}
                        key={workflow.id}
                      >
                        {workflow.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="plan-actions">
                <span className={`status status-${displayedPlan.status.toLowerCase()}`}>
                  {displayedPlan.status}
                </span>
                {!isExample && (
                  <button className="download-button" type="button" onClick={downloadPlan}>
                    Download plan
                  </button>
                )}
              </div>
            </div>

            <ol className="plan-steps">
              {displayedPlan.steps.map((step, index) => (
                <li className={`plan-step plan-step-${step.status.toLowerCase()}`} key={step.id}>
                  <span className="step-number">{index + 1}</span>
                  <div>
                    <div className="plan-step-heading">
                      <h3>{step.title}</h3>
                      <span>{step.status}</span>
                    </div>
                    {step.command && <code className="command">{step.command}</code>}
                    {step.instruction && <p className="plan-instruction">{step.instruction}</p>}
                    {step.status === "MISSING" && (
                      <p className="plan-missing">The repository does not document this step.</p>
                    )}
                    {step.evidence?.file && (
                      <p className="evidence">
                        <span>Evidence</span>
                        <EvidenceLink report={report} evidence={step.evidence} />
                      </p>
                    )}
                    {step.references?.length > 0 && (
                      <div className="plan-tags" aria-label="Validated command references">
                        {step.references.map((reference) => (
                          <code className={reference.exists === false ? "tag-missing" : "tag-valid"} key={reference.path}>
                            {reference.external ? "External" : reference.exists ? "Found" : "Unknown"} · {reference.path}
                          </code>
                        ))}
                      </div>
                    )}
                    {step.parameters?.length > 0 && (
                      <div className="plan-tags" aria-label="Experiment parameters">
                        {step.parameters.map((parameter) => (
                          <code key={parameter.name}>
                            {parameter.name}{parameter.default === null ? "" : `=${parameter.default}`}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {displayedPlan.steps.length === 0 && (
                <li className="workflow-empty">No matching entry point was found in the README.{activeWorkflow?.id === "evaluation" && " You can explicitly supply and review an Evaluation entry below; it is not a discovered README command."}</li>
              )}
            </ol>
          </section>
        )}

        {!isExample && report.evaluationDraft && !acceptance.benchmarkId && <CandidateConfig key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onApply={applyCandidate} />}

        {!isExample && activeWorkflow && (
          <section className="runner" aria-labelledby="runner-title">
            <div className="runner-heading">
              <div>
                <p className="eyebrow">Isolated execution preview</p>
                <h2 id="runner-title" tabIndex={-1}>Check before running unknown code</h2>
                <p>Re-scan the pinned commit and inspect the local Docker runner.</p>
              </div>
              <button type="button" onClick={checkPreflight} disabled={executionBusy || (acceptance.candidateReview && !acceptance.candidateReview.confirmed) || (activeWorkflow.id === "training" && !acceptance.benchmarkId && !acceptance.experiment)}>
                {preflightLoading ? "Checking…" : "Check local runner"}
              </button>
            </div>

            {preflightError && <p className="runner-error" role="alert">{preflightError}</p>}
            {activeWorkflow.id === "training" && !acceptance.benchmarkId && <>
              <ExperimentConfig key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onApply={applyExperiment} onInvalidate={invalidateExperiment} />
              <p className="hint" role="status">{acceptance.experiment ? "Reviewed experiment applied. Check local runner to inspect every effective command before execution." : "Review and apply an experiment configuration to enable the runner check."}</p>
            </>}
            {acceptance.benchmarkId && <div className="run-comparison">
              <h3>{selectedReviewedCase.title}</h3>
              <p>{selectedReviewedCase.dataset}</p>
              <p>{acceptance.model}</p>
              {selectedReviewedCase.training && <p className="runner-note">{selectedReviewedCase.training.scope}</p>}
              <p><a href={selectedReviewedCase.reference.url} target="_blank" rel="noreferrer">Pinned reference: {selectedReviewedCase.metricKey ?? "accuracy"} {selectedReviewedCase.reference.value} · tolerance {selectedReviewedCase.reference.tolerance}</a></p>
              <p className="hint">Fixed output checks: published-benchmark-ok · fresh benchmark-result.json · {selectedReviewedCase.metricKey ?? "accuracy"} = {selectedReviewedCase.reference.value} ± {selectedReviewedCase.reference.tolerance}.</p>
              <p className="runner-note">{selectedReviewedCase.compatibility.note}</p>
              <p className="hint">Commands and expectations are fixed for this reviewed case. Choose another workflow or scan again to return to custom Evaluation.</p>
              <details><summary>Review benchmark manifest and adapter source</summary><pre className="evaluation-source">{JSON.stringify(selectedReviewedCase, null, 2)}{"\n\n"}{selectedBenchmarkSource}{selectedReviewedCase.training && <>{"\n\n"}{trainingSource}</>}</pre></details>
            </div>}
            {["quick", "evaluation"].includes(activeWorkflow.id) && !acceptance.benchmarkId && (
              <fieldset className="run-options" disabled={optionsLocked}>
                <legend>Entry and output expectations</legend>
                <label htmlFor="quick-command">Reviewed {activeWorkflow.id === "evaluation" ? "Evaluation" : "Quick"} command (optional)</label>
                <input id="quick-command" value={quickCommand} maxLength={6000}
                  placeholder="Leave blank to use the README entry point"
                  disabled={optionsLocked}
                  onChange={(event) => { setQuickCommand(event.target.value); if (acceptance.candidateReview) updateAcceptance("candidateReview", { ...acceptance.candidateReview, confirmed: false }); setPreflight(null); setRunConfirmed(false); }} />
                <p className="hint">Replaces the final entry point, not dependency installation. Evaluation can use an explicit reviewed entry when none was detected. Review every effective command below.</p>
                {quickCommand === cpuEvaluationCommand && <details><summary>Review CPU evaluation example source</summary><pre className="evaluation-source">{cpuEvaluationSource}</pre></details>}
                <label htmlFor="expected-text">Expected text in the entry output (optional)</label>
                <input id="expected-text" value={acceptance.expectedText} maxLength={300} disabled={optionsLocked}
                  placeholder="For example: autodiff-ok" onChange={(event) => updateAcceptance("expectedText", event.target.value)} />
                <label htmlFor="output-file">Expected new or changed output file (optional)</label>
                <input id="output-file" value={acceptance.outputFile} maxLength={240} disabled={optionsLocked}
                  placeholder="results/metrics.json — relative to the repository" onChange={(event) => updateAcceptance("outputFile", event.target.value)} />
                <div className="metric-options">
                  <label>JSON key / CSV column (optional)<input value={acceptance.metricKey} maxLength={100} disabled={optionsLocked}
                    placeholder="accuracy or evaluation.accuracy" onChange={(event) => updateAcceptance("metricKey", event.target.value)} /></label>
                  <label>Condition<select value={acceptance.metricOperator} disabled={optionsLocked}
                    onChange={(event) => updateAcceptance("metricOperator", event.target.value)}><option value="gte">At least (≥)</option><option value="lte">At most (≤)</option><option value="eq">Match reference (±)</option></select></label>
                  <label>Target<input type="number" step="any" value={acceptance.metricTarget} disabled={optionsLocked}
                    onChange={(event) => updateAcceptance("metricTarget", event.target.value)} /></label>
                </div>
                {acceptance.metricOperator === "eq" && <label>Absolute tolerance<input type="number" min="0" step="any" value={acceptance.metricTolerance} disabled={optionsLocked}
                  onChange={(event) => updateAcceptance("metricTolerance", event.target.value)} /></label>}
                {activeWorkflow.id === "evaluation" && <>
                  <label>Dataset / evaluation split (required)<input value={acceptance.dataset} maxLength={500} disabled={optionsLocked} placeholder="Dataset version, held-out split, acquisition path"
                    onChange={(event) => updateAcceptance("dataset", event.target.value)} /></label>
                  <label>Model / checkpoint (required)<input value={acceptance.model} maxLength={500} disabled={optionsLocked} placeholder="Architecture, checkpoint version, source"
                    onChange={(event) => updateAcceptance("model", event.target.value)} /></label>
                  <label>Reference metric source (required)<input value={acceptance.reference} maxLength={500} disabled={optionsLocked} placeholder="Pinned README/table/paper URL, or explicitly user-defined target"
                    onChange={(event) => updateAcceptance("reference", event.target.value)} /></label>
                  <label className="runner-confirm"><input type="checkbox" checked={acceptance.assetsInEntry} disabled={optionsLocked}
                    onChange={(event) => updateAcceptance("assetsInEntry", event.target.checked)} />My reviewed entry handles dataset and model preparation; replace separate data/model steps explicitly.</label>
                  <p className="hint">Required: a new/changed JSON or single-row CSV file and numeric metric. Units must match the reference; no implicit conversion. Context is user-declared; CPU/2 GB/10 minute limits still apply.</p>
                  {acceptance.candidateReview && <label className="runner-confirm"><input type="checkbox" checked={acceptance.candidateReview.confirmed}
                    onChange={(event) => updateAcceptance("candidateReview", { ...acceptance.candidateReview, confirmed: event.target.checked })} />I reviewed the candidate sources, completed missing fields, and confirmed this command, dataset/split, model and reference correspond. Editing any field requires review again.</label>}
                </>}
              </fieldset>
            )}
            {preflight && (
              <div className="runner-result" aria-live="polite">
                <div className={`runner-state ${preflight.runtime.available ? "runner-ready" : "runner-unavailable"}`}>
                  <strong>{preflight.runtime.available ? "Docker ready" : preflight.runtime.reason}</strong>
                  <span>{preflight.limits.cpus} CPUs · {preflight.limits.memory} · {preflight.limits.timeoutMinutes} minute limit · no host mounts</span>
                </div>
                <h3>Automated steps</h3>
                {preflight.commandOverride && <p className="runner-note">User-reviewed override · original: {preflight.commandOverride.original}</p>}
                {preflight.preparationOverride && <details><summary>Explicit dataset/model preparation override</summary><pre>{JSON.stringify(preflight.preparationOverride, null, 2)}</pre></details>}
                {preflight.benchmark && <details><summary>Reviewed compatibility profile, hash locks and original README steps</summary><pre className="evaluation-source">{JSON.stringify(preflight.benchmark, null, 2)}</pre></details>}
                {preflight.candidate && <details><summary>Reviewed generated configuration and manual changes</summary><pre className="evaluation-source">{JSON.stringify(preflight.candidate, null, 2)}</pre></details>}
                <ol>
                  {preflight.automatedSteps.map((step) => (
                    <li key={step.id}><span>{step.title}</span><code className="command">{step.effectiveCommand ?? step.command}</code></li>
                  ))}
                </ol>
                {preflight.manualSteps.length > 0 && (
                  <>
                    <h3>Manual preparation</h3>
                    <ul>
                      {preflight.manualSteps.map((step) => (
                        <li key={step.id}><span>{step.title}</span><code className="command">{step.instruction}</code></li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="runner-note">Output checks: {preflight.executionOptions.expectedText || preflight.executionOptions.outputFile
                  ? [preflight.executionOptions.expectedText && `text: ${preflight.executionOptions.expectedText}`, preflight.executionOptions.outputFile && `new/changed file: ${preflight.executionOptions.outputFile}`,
                    preflight.executionOptions.metricKey && `metric: ${preflight.executionOptions.metricKey} ${preflight.executionOptions.metricOperator === "eq" ? "=" : preflight.executionOptions.metricOperator === "gte" ? ">=" : "<="} ${preflight.executionOptions.metricTarget}${preflight.executionOptions.metricOperator === "eq" ? ` ± ${preflight.executionOptions.metricTolerance}` : ""}`].filter(Boolean).join(" · ")
                  : "none — execution exit code only"}</p>
                <label className="runner-confirm">
                  <input
                    type="checkbox"
                    checked={runConfirmed}
                    disabled={optionsLocked}
                    onChange={(event) => setRunConfirmed(event.target.checked)}
                  />
                  I understand this runs untrusted code with network access inside a temporary Docker container.
                </label>
                <button
                  type="button"
                  onClick={() => startExecution("readme")}
                  disabled={!preflight.runnable || !runConfirmed || executionBusy}
                >
                  {runLoading ? "Starting…" : activeWorkflow.id === "training" ? "Run Training reproduction" : activeWorkflow.id === "evaluation" ? "Run Evaluation" : "Run Quick verification"}
                </button>
                {!preflight.runnable && (
                  <p className="runner-note">{preflight.reason ?? "The workflow is not ready to execute."}</p>
                )}
              </div>
            )}
          </section>
        )}
            {runJob && (
              <section className="runner" id="current-execution" tabIndex={-1} aria-label="Current execution">
              <div className="run-log" aria-live="polite">
                <div>
                  <strong>
                    Execution {runJob.status.replaceAll("_", " ")} · {runJob.replayOf ? "Locked recipe" : runJob.packageIndex === "pypi" ? "Official PyPI" : "README package source"}
                  </strong>
                  {runJob.status === "RUNNING" && (
                    <button className="download-button" type="button" onClick={cancelExecution}>Cancel</button>
                  )}
                </div>
                <ol className="run-progress">
                  {runJob.steps.map((step) => (
                    <li className={`run-step-${step.status.toLowerCase()}`} key={step.id}>
                      <span>{step.status}</span>{step.title}
                    </li>
                  ))}
                </ol>
                {runJob.failureStep && (
                  <p className="runner-error">Stopped at: {runJob.failureStep.title}</p>
                )}
                {runJob.diagnosis && <p className="run-diagnosis">{runJob.diagnosis}</p>}
                {["FAILED", "TIMED_OUT"].includes(runJob.status)
                  && runJob.failureStep?.id === "install"
                  && !runJob.replayOf && runJob.packageIndex === "readme" && (
                    <button type="button" onClick={() => startExecution("pypi", runJob)} disabled={executionBusy || !runConfirmed || !!runJob.replayOf}>
                      {runLoading ? "Starting…" : "Retry with official PyPI"}
                    </button>
                )}
                <ExecutionEvidence job={runJob} onPrepareReplay={prepareReplay} replayDisabled={executionBusy} />
                <pre>{visibleRunLog(runJob.log) || "Starting isolated container…"}</pre>
              </div>
              </section>
            )}
        <section className="runner run-history" aria-labelledby="history-title">
          <div className="runner-heading">
            <div><p className="eyebrow">Local evidence archive</p><h2 id="history-title">Recent executions</h2>
              <p>Records stay on this computer and survive server restarts. They are not uploaded to GitHub.</p></div>
            <button className="download-button" type="button" onClick={refreshHistory}>Refresh history</button>
          </div>
          {historyError && <p className="runner-note" role="status">{historyError}</p>}
          {history.length === 0 && !historyError && <p className="hint">No saved executions yet.</p>}
          <ul className="history-list">
            {history.map((entry) => <li key={entry.id}>
              <div><strong>{entry.repository}</strong><p className="hint">{entry.workflowId ?? "quick"} · Execution: {entry.status} · Output checks: {entry.verificationStatus}{entry.evaluationStatus && ` · Evaluation: ${entry.evaluationStatus}`} · commit {entry.commit.slice(0, 7)} · {new Date(entry.startedAt).toLocaleString()}</p></div>
              <button className="download-button" type="button" onClick={() => openHistory(entry.id)}>View record</button>
            </li>)}
          </ul>
          {archivedJob && <div className="run-log">
            <div><strong>{archivedJob.repository} · {archivedJob.status}</strong><button className="download-button" type="button" onClick={() => setArchivedJob(null)}>Close record</button></div>
            <p className="commit">{archivedJob.id} · Commit {archivedJob.commit}</p>
            {archivedJob.diagnosis && <p className="run-diagnosis">{archivedJob.diagnosis}</p>}
            <ExecutionEvidence job={archivedJob} onPrepareReplay={prepareReplay} replayDisabled={executionBusy} />
            <pre>{visibleRunLog(archivedJob.log) || "No log captured."}</pre>
          </div>}
        </section>
        {(replayPreview || replayLoading || replayError) && <section className="runner recipe-preview" aria-labelledby="recipe-title">
          <div className="runner-heading"><div><p className="eyebrow">Frozen reproduction recipe</p><h2 id="recipe-title" tabIndex={-1}>Review before replaying</h2></div>
            <button className="download-button" type="button" disabled={executionBusy} onClick={() => { setReplayPreview(null); setReplayError(""); setReplayConfirmed(false); }}>Close recipe</button></div>
          {replayLoading && <p role="status">Checking the exact local image…</p>}
          {replayError && <p className="runner-error" role="alert">{replayError}</p>}
          {replayPreview && <>
            <p>{replayPreview.repository} · pinned commit {replayPreview.commit}</p>
            <p className="hint">The saved commit is fetched directly; changes to the latest GitHub branch do not change this recipe.</p>
            <p className="commit">Image {replayPreview.recipe.imageId} · Python {replayPreview.recipe.python}</p>
            <p className="hint">{replayPreview.limits.cpus} CPUs · {replayPreview.limits.memory} · {replayPreview.limits.timeoutMinutes} minute limit · no host mounts</p>
            {replayPreview.benchmark && <>
              <p className="runner-note">{replayPreview.benchmark.compatibility.note}</p>
              <details><summary>Frozen benchmark input hashes and pinned reference</summary><pre>{JSON.stringify(replayPreview.benchmark, null, 2)}</pre></details>
            </>}
            {replayPreview.candidate && <details><summary>Frozen reviewed candidate sources</summary><pre>{JSON.stringify(replayPreview.candidate, null, 2)}</pre></details>}
            <ol>{replayPreview.automatedSteps.map((step) => <li key={step.id}><strong>{step.title}</strong><code className="command">{step.command}</code></li>)}</ol>
            <details><summary>Locked dependencies and output expectations</summary><pre>{JSON.stringify({ dependencies: replayPreview.recipe.dependencies, expectations: replayPreview.executionOptions }, null, 2)}</pre></details>
            {replayPreview.recipe.warnings.map((warning) => <p className="runner-note" key={warning}>{warning}</p>)}
            {!replayPreview.runnable && <p className="runner-error" role="alert">{replayPreview.reason}</p>}
            <label className="runner-confirm"><input type="checkbox" checked={replayConfirmed} disabled={executionBusy}
              onChange={(event) => setReplayConfirmed(event.target.checked)} />I reviewed this frozen recipe and understand it re-runs untrusted code with network access in a new temporary container.</label>
            <button type="button" disabled={!replayPreview.runnable || !replayConfirmed || executionBusy} onClick={startReplay}>{runLoading ? "Starting…" : "Replay frozen recipe"}</button>
          </>}
        </section>}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
