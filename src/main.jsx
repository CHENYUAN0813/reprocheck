import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./cinematic.css";
import cpuEvaluationSource from "../examples/evaluate-micrograd.py?raw";
import { reviewedBenchmarks, reviewedTrainings, reviewedCaseById } from "../examples/reviewed-cases.mjs";
import publishedEvaluationSource from "../examples/evaluate-bthowen.py?raw";
import capacityEvaluationSource from "../examples/evaluate-capacity-probes.py?raw";
import capacityMatrixSource from "../examples/evaluate-capacity-matrix.py?raw";
import trainingSource from "../examples/train-bthowen.py?raw";
import { candidateOptions, candidateWorkflow, suggestCandidate } from "../evaluation-config.mjs";
import { experimentDraft, experimentExecutionOptions, importedExperimentDraft, MODEL_EXPORT_LIMIT } from "../experiment-config.mjs";

const emptyAcceptance = { expectedText: "", outputFile: "", metricKey: "", metricOperator: "gte", metricTarget: "", metricTolerance: "0", dataset: "", model: "", reference: "", assetsInEntry: false };
const cpuEvaluationCommand = `python -c 'exec(${JSON.stringify(cpuEvaluationSource).replaceAll("'", "'\"'\"'")})'`;
const benchmarkSources = { bthowen: publishedEvaluationSource, "capacity-probes": capacityEvaluationSource, "capacity-matrix": capacityMatrixSource };
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

function PaperMatrix({ report, disabled, onApply }) {
  const draft = report.paperMatrixDraft;
  const ready = draft?.adapters?.[0];
  const [config, setConfig] = useState({ adapterId: ready?.id ?? "", outputFile: "", rowKey: "dataset", metricTolerance: "0", confirmed: false,
    acknowledgeGaps: report.protocolLock?.gaps.length === 0 });
  if (!draft) return null;
  const update = (field, value) => setConfig((current) => ({ ...current, [field]: value, ...(field === "confirmed" ? {} : { confirmed: false }) }));
  const apply = () => onApply({ adapterId: config.adapterId, protocolLockId: report.protocolLock.lockId, outputFile: config.outputFile.trim(), rowKey: config.rowKey.trim(),
    metricTolerance: Number(config.metricTolerance), confirmed: true, acknowledgedGaps: config.acknowledgeGaps ? report.protocolLock.gaps : [] });
  return <section className="runner" aria-labelledby="paper-matrix-title">
    <div className="runner-heading"><div><p className="eyebrow">Multi-experiment reproduction</p><h2 id="paper-matrix-title">Paper result matrix</h2>
      <p>Run one reviewed source workflow, then compare every dataset × model × seed cell with the pinned README table.</p></div>
      <span className={`status status-${draft.status.toLowerCase()}`}>{draft.status.replaceAll("_", " ")}</span></div>
    {draft.cells.length > 0 && <div className="matrix-scroll"><table className="matrix-table"><thead><tr><th>Dataset</th><th>Model</th><th>Seed</th><th>Metric</th><th>Paper reference</th></tr></thead>
      <tbody>{draft.cells.map((cell) => <tr key={cell.id}><td>{cell.dataset}</td><td>{cell.model}</td><td>{cell.seed ?? "—"}</td><td>{cell.metricLabel}</td><td>{cell.target} · {cell.unit}</td></tr>)}</tbody></table></div>}
    {draft.gaps.length > 0 && <p className="runner-note">Blocked by: {draft.gaps.join("; ")}.</p>}
    {ready && report.protocolLock && <fieldset className="run-options" disabled={disabled}>
      <legend>Reviewed matrix output contract</legend>
      <label>Source workflow adapter<select value={config.adapterId} onChange={(event) => update("adapterId", event.target.value)}>{draft.adapters.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.title}</option>)}</select></label>
      <label>Produced CSV path<input maxLength={240} value={config.outputFile} placeholder="results/table1.csv" onChange={(event) => update("outputFile", event.target.value)} /></label>
      <label>Dataset row-key column<input maxLength={100} value={config.rowKey} onChange={(event) => update("rowKey", event.target.value)} /></label>
      <label>Absolute tolerance for every cell<input type="number" min="0" step="any" value={config.metricTolerance} onChange={(event) => update("metricTolerance", event.target.value)} /></label>
      {report.protocolLock.gaps.length > 0 && <label className="runner-confirm"><input type="checkbox" checked={config.acknowledgeGaps} onChange={(event) => update("acknowledgeGaps", event.target.checked)} />I reviewed and accept these unresolved lock gaps for this run: {report.protocolLock.gaps.join("; ")}.</label>}
      <label className="runner-confirm"><input type="checkbox" checked={config.confirmed} onChange={(event) => update("confirmed", event.target.checked)} />I reviewed the adapter, CSV row/column labels, paper references and protocol lock. The workflow is untrusted code.</label>
      <button type="button" disabled={!config.confirmed || !config.outputFile.trim() || !config.acknowledgeGaps || !Number.isFinite(Number(config.metricTolerance)) || Number(config.metricTolerance) < 0} onClick={apply}>Use matrix in local runner</button>
    </fieldset>}
    {draft.warnings.map((warning) => <p className="runner-note" key={warning}>{warning}</p>)}
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
    {draft.entries.length === 0 ? <p className="runner-note">No supported metric-evaluation candidate was found in the sampled Python files. A Quick/Make entry may still be available above. Supply a custom Evaluation below; no command or benchmark is invented.</p> : <fieldset className="run-options" disabled={disabled}>
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

function SavedExperimentImport({ disabled, onOpenVersion }) {
  const [pendingImport, setPendingImport] = useState(null);
  const [error, setError] = useState("");
  async function importConfig(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingImport(null);
    try {
      if (file.size > 32000) throw new Error("Experiment configuration is limited to 32 KB");
      const config = JSON.parse(await file.text());
      const next = importedExperimentDraft(config);
      setPendingImport(next); setError("");
    } catch (failure) { setError(failure.message); }
  }
  return <fieldset className="run-options" disabled={disabled}>
    <legend>Open a saved Training experiment</legend>
    <label>Import saved experiment configuration<input type="file" accept=".json,application/json" onChange={importConfig} /></label>
    {pendingImport && <div role="status"><p>Saved configuration: <strong>{pendingImport.repository}</strong> · commit <code>{pendingImport.commit}</code>. Scan this exact version before reviewing commands. No code will run.</p>
      <button type="button" onClick={async () => { if (await onOpenVersion(pendingImport)) setPendingImport(null); }}>Scan saved version</button>
      <button type="button" onClick={() => setPendingImport(null)}>Cancel import</button></div>}
    {error && <p className="runner-error" role="alert">{error}</p>}
  </fieldset>;
}

function SuggestedEntry({ report, disabled, onChoose }) {
  const entries = report.quickEntries ?? [];
  const [id, setId] = useState(report.recommendedQuickEntryId ?? "");
  const selected = entries.find((entry) => entry.id === id);
  const readme = report.checks.find((check) => check.id === "readme")?.evidence;
  return <section className="runner candidate-config" aria-labelledby="suggested-entry-title">
    <h2 id="suggested-entry-title">Start here · check one entry</h2>
    <p>Quick checks whether the selected entry executes. It is not full training or metric acceptance. Commands remain untrusted and will not run until you review and confirm. Prerequisites can download large dependencies or datasets; Quick does not mean a small download.</p>
    {entries.length ? <>
      <label>Suggested entry<select value={id} disabled={disabled} onChange={(event) => setId(event.target.value)}>
        <option value="">Choose an entry — no automatic choice</option>
        {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.id === report.recommendedQuickEntryId ? "Recommended · " : ""}{entry.command} · {entry.status}</option>)}
      </select></label>
      {selected && <><p><EvidenceLink report={report} evidence={selected.evidence} /></p>
        <p className="hint">{selected.role === "preflight" ? "A source-validated test entry is available; start here before the experiment." : "Review this entry and its prerequisites; Quick does not imply a short or inexpensive run."}</p>
        <ol>{selected.steps.map((step) => <li key={step.id}>{step.title} · {step.status}{step.command && <pre>{step.command}</pre>}</li>)}</ol>
      </>}
      <button type="button" disabled={disabled || !selected || selected.status === "BLOCKED"} onClick={() => onChoose(selected)}>Review selected entry in Quick</button>
      {selected?.status === "BLOCKED" && <p className="runner-note">Some prerequisite targets could not be validated. Review their source before execution.</p>}
    </> : <p className="runner-note">No supported entry was automatically validated. Review {readme ? <EvidenceLink report={report} evidence={readme} /> : <a href={`https://github.com/${report.repository}/tree/${report.commit}`} target="_blank" rel="noreferrer">repository source</a>} and the repository's Python scripts{report.paperWorkflowDraft?.makefile && <> / <EvidenceLink report={report} evidence={{ file: report.paperWorkflowDraft.makefile }} /></>}. This does not mean the repository has no instructions.</p>}
  </section>;
}

function ExperimentConfig({ report, disabled, onApply, onInvalidate, importedDraft }) {
  const [draft, setDraft] = useState(() => importedDraft ?? experimentDraft(report));
  const [error, setError] = useState("");
  useEffect(() => { if (importedDraft) { setDraft(importedDraft); setError(""); } }, [importedDraft]);
  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value, confirmed: key === "confirmed" ? value : false }));
    setError(""); onInvalidate();
  }
  function apply(download = false) {
    try {
      const options = experimentExecutionOptions({ ...draft, ...(draft.inputs ? { inputs: Object.fromEntries(Object.entries(draft.inputs).map(([stage, paths]) => [stage, paths.map((path) => path.trim()).filter(Boolean)])) } : {}) });
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
    {fields.map(([key, label, limit = 500]) => <label key={key}>{label}<input value={draft[key]} maxLength={limit} onChange={(event) => update(key, event.target.value)} /></label>)}
    <p className="hint">Optional required input files: one repository-relative path per line, checked immediately before that stage. Files generated by preparation belong under Training, not Preparation. Existing new-model/output checks remain separate; this does not verify dataset contents.</p>
    {[["prepare-data", "Preparation"], ["train", "Training"], ["evaluate", "Evaluation"]].map(([stage, title]) => <label key={stage}>{title} required inputs (optional)
      <textarea rows={2} maxLength={4820} value={(draft.inputs?.[stage] ?? []).join("\n")} onChange={(event) => update("inputs", { ...draft.inputs, [stage]: event.target.value.split("\n") })} />
    </label>)}
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
      <dl className="result-dimensions">
        <div><dt>Process</dt><dd>{job.status.replaceAll("_", " ")}</dd></div>
        <div><dt>Output checks</dt><dd>{labels[job.verification?.status] ?? "Not available"}</dd></div>
        <div><dt>Reference acceptance</dt><dd>{job.evaluation?.status?.replaceAll("_", " ") ?? (job.matrix ? `${job.matrix.summary.matched}/${job.matrix.summary.total} cells matched` : "No evaluation result")}</dd></div>
        <div><dt>Scope</dt><dd>Selected experiment only</dd></div>
      </dl>
      <h3>Output verification · {labels[job.verification?.status] ?? "Not available"}</h3>
      <p className="hint">Execution success alone does not prove paper reproducibility. These checks validate only the expectations you supplied.</p>
      {job.persistenceError && <p className="runner-error" role="alert">{job.persistenceError} — download the evidence now.</p>}
      {job.logTruncated && <p className="runner-note">Only the last 900,000 log characters are retained.</p>}
      <details className="verification-details"><summary>Inspect output and input checks ({job.verification?.checks?.length ?? 0})</summary><ul className="verification-checks">
        {job.verification?.checks?.map((check) => (
          <li key={check.id}><strong>{check.status}</strong> · {check.id}: <code>{check.expected}</code>
            {check.observed && <details><summary>Inspect captured evidence</summary><pre>{JSON.stringify(check.observed, null, 2)}</pre></details>}
          </li>
        ))}
      </ul></details>
      {job.paperMatrix && <div className="run-comparison">
        <h3>Paper matrix · {job.matrix ? `${job.matrix.summary.matched}/${job.matrix.summary.total} matched` : "incomplete"}</h3>
        <p className="hint">Observed values come from the fresh CSV produced by the reviewed source workflow. References come from the commit-pinned README table.</p>
        {job.matrix?.error && <p className="runner-error">{job.matrix.error}</p>}
        {job.matrix?.cells?.length > 0 && <div className="matrix-scroll"><table className="matrix-table"><thead><tr><th>Dataset</th><th>Model</th><th>Paper</th><th>Observed</th><th>Delta</th><th>Status</th></tr></thead>
          <tbody>{job.matrix.cells.map((cell) => <tr key={cell.id}><td>{cell.dataset}</td><td>{cell.model}{cell.seed ? ` · seed ${cell.seed}` : ""}</td><td>{cell.target}</td><td>{cell.observed ?? "—"}{cell.compared !== cell.observed && cell.compared != null ? ` → ${cell.compared}` : ""}</td><td>{cell.delta ?? "—"}</td><td>{cell.status}</td></tr>)}</tbody></table></div>}
      </div>}
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
        <h3>Compared with baseline</h3>
        <p className="hint">Baseline {job.comparison.baselineRunId}. Differences do not mean acceptance failed; identical results do not prove acceptance passed. Changes alone do not explain their cause.</p>
        <p>Current acceptance: <strong>{labels[job.verification?.status] ?? "Not available"}</strong> · execution: {job.status}.</p>
        <p>Metric requirement: {job.executionOptions?.metricKey ? `${job.executionOptions.metricKey} ${job.executionOptions.metricOperator} ${job.executionOptions.metricTarget} (tolerance ${job.executionOptions.metricTolerance ?? 0})` : "No numeric requirement configured"}. See output checks above for individual failures.</p>
        {job.comparison.groups ? Object.entries(job.comparison.groups).map(([name, group]) => <p key={name}>{name === "inputs" ? "Code, environment and conditions" : "Observed outputs"}: <strong>{group.status}</strong>{group.unknownCount > 0 && ` · ${group.unknownCount} unavailable field(s)`}</p>)
          : <p className="hint">Older record: grouped difference summary was not saved. Inspect individual fields below.</p>}
        <ul className="verification-checks">
          {job.comparison.rows.map((row) => <li key={row.id}>
            <strong>{row.status}</strong> · {row.id}{row.key && ` (${row.key})`}{row.delta !== undefined && ` · delta: ${row.delta ?? "unknown"}`}{row.id === "metric" && ` · observed ${row.baseline ?? "unknown"} → ${row.current ?? "unknown"}`}
            <details><summary>Baseline / replay values</summary><pre>{JSON.stringify({ baseline: row.baseline, replay: row.current }, null, 2)}</pre></details>
          </li>)}
        </ul>
      </div>}
    </div>
  );
}

function LandingHero() {
  const [motion, setMotion] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotion(!preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  return <section className="cinema-hero" aria-labelledby="workspace-title">
    <div className="cinema-background" aria-hidden="true">
      {motion && !videoFailed && <video autoPlay muted loop playsInline preload="metadata" onError={() => setVideoFailed(true)}
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4" />}
    </div>
    <div className="cinema-copy">
      <p className="capability-pill"><span aria-hidden="true">✳</span> Public source. Explicit evidence.</p>
      <h1 id="workspace-title" tabIndex={-1}><span>Research code.</span><span>Verifiable results.</span></h1>
      <p className="cinema-description">Inspect a research repository, review its experiment,<br className="desktop-break" /> and check the result against a declared reference.</p>
      <button className="cinema-cta" type="button" onClick={() => { document.getElementById("repository")?.focus({ preventScroll: true }); document.getElementById("scan-form")?.scrollIntoView({ block: "start" }); }}>Start a scan <span aria-hidden="true">↗</span></button>
      <p className="cinema-caption">Scanning needs no Docker. Execution stays local.</p>
    </div>
    <ol className="cinema-stages" aria-label="Reproduction workflow">
      <li><span aria-hidden="true">01</span><strong>Scan</strong><small>Source-linked findings</small></li>
      <li><span aria-hidden="true">02</span><strong>Review</strong><small>Commands and inputs</small></li>
      <li><span aria-hidden="true">03</span><strong>Execute</strong><small>Local Docker workflow</small></li>
      <li><span aria-hidden="true">04</span><strong>Verify</strong><small>Declared reference checks</small></li>
    </ol>
    <button className="motion-toggle" type="button" disabled={videoFailed} aria-pressed={motion && !videoFailed} onClick={() => setMotion(!motion)}>{videoFailed ? "Static background · video unavailable" : motion ? "Pause background" : "Play background"}</button>
  </section>;
}

function App() {
  const [page, setPage] = useState("scan");
  const [url, setUrl] = useState("");
  const [report, setReport] = useState(exampleReport);
  const [importedDraft, setImportedDraft] = useState(null);
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
  useEffect(() => { if (runJob?.id) setPage("run"); }, [runJob?.id]);
  useEffect(() => { document.getElementById("workspace-title")?.focus(); }, [page]);
  useEffect(() => { if (archivedJob) document.getElementById("archived-execution")?.focus(); }, [archivedJob]);
  async function prepareReplay(id) {
    setPage("history");
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
  const selectedReviewedCase = acceptance.benchmarkId ? reviewedCaseById.get(acceptance.benchmarkId) : null;
  const reviewedMatrixWorkflow = selectedWorkflow === "paper-matrix" && selectedReviewedCase?.matrix ? { id: "paper-matrix", title: selectedReviewedCase.title, status: "REVIEWED_BENCHMARK", steps: [
    { id: "install", title: "Install reviewed Python 3.10 CPU dependencies", status: "DOCUMENTED", command: selectedReviewedCase.installCommand },
    { id: "prepare-assets", title: "Prepare five hash-locked public datasets", status: "DOCUMENTED", instruction: "The reviewed adapter runs the authors' public-data setup and preparation entries." },
    { id: "evaluation-benchmark", title: `Run and verify all ${selectedReviewedCase.matrix.cells.length} original CPU result cells`, status: "DOCUMENTED", instruction: "The authors' deterministic launcher computes MC, SeqRules and PCTM on every dataset; ReproCheck verifies each original result and emits a CSV matrix." },
  ] } : null;
  const selectedMatrixAdapter = report.paperMatrixDraft?.adapters.find((adapter) => adapter.id === acceptance.paperMatrix?.adapterId);
  const matrixWorkflow = selectedWorkflow === "paper-matrix" && selectedMatrixAdapter ? { id: "paper-matrix", title: "Paper result matrix", status: "USER_REVIEWED_MATRIX",
    steps: selectedMatrixAdapter.steps.map((step) => ({ ...step, title: `${step.role} · ${step.command}`, status: "USER_REVIEWED" })) } : null;
  const selectedQuickEntry = selectedWorkflow === "quick" && report.quickEntries?.find((entry) => entry.id === acceptance.quickEntryId);
  const activeWorkflow = reviewedMatrixWorkflow ?? matrixWorkflow ?? (selectedQuickEntry ? { id: "quick", title: "Quick verification", status: selectedQuickEntry.status, steps: selectedQuickEntry.steps } : null) ?? report.workflows?.find((workflow) => workflow.id === selectedWorkflow)
    ?? report.workflows?.[0]
    ?? null;
  const selectedCandidate = report.evaluationDraft?.entries.find((entry) => entry.id === acceptance.candidateReview?.entryId);
  const selectedBenchmarkSource = selectedReviewedCase ? benchmarkSources[selectedReviewedCase.adapter] : null;
  const displayedPlan = reviewedMatrixWorkflow ?? matrixWorkflow ?? (acceptance.experiment ? { title: acceptance.experiment.title, status: "USER_REVIEWED_EXPERIMENT", steps: [
    ...(acceptance.experiment.installCommand ? [{ id: "install", title: "Install reviewed dependencies", status: "USER_REVIEWED", command: acceptance.experiment.installCommand }] : []),
    ...(acceptance.experiment.prepareCommand ? [{ id: "prepare-data", title: "Prepare data", status: "USER_REVIEWED", command: acceptance.experiment.prepareCommand }] : []),
    { id: "train", title: "Train and save new model", status: "USER_REVIEWED", command: acceptance.experiment.trainCommand },
    { id: "evaluate", title: "Evaluate new model", status: "USER_REVIEWED", command: quickCommand },
  ] } : selectedReviewedCase?.training ? { title: selectedReviewedCase.title, status: "REVIEWED_TRAINING", steps: [
    { id: "install", title: "Install reviewed CPU dependencies", status: "DOCUMENTED", command: selectedReviewedCase.installCommand },
    { id: "prepare-assets", title: `Prepare hash-locked real UCI ${selectedReviewedCase.datasetName} data`, status: "DOCUMENTED", instruction: "Reviewed adapter downloads UCI data and applies the explicit MNIST-only import compatibility patch. Check the local runner for exact commands." },
    { id: "training-benchmark", title: "Train from scratch and save a new model", status: "DOCUMENTED", command: `cd software_model && python train_swept_models.py ${selectedReviewedCase.training.arguments.join(" ")}`, instruction: `Reviewed launcher sets NumPy seed ${selectedReviewedCase.training.seed} before calling the original trainer. This is the original invocation, not the complete seeded adapter.` },
    { id: "evaluation-benchmark", title: `Evaluate the newly trained model and compare with ${selectedReviewedCase.reference.value}`, status: "DOCUMENTED", instruction: "Original evaluate.py reads the newly trained checkpoint; the adapter records actual held-out accuracy as JSON." },
  ] } : selectedReviewedCase ? { title: selectedReviewedCase.title, status: "REVIEWED_BENCHMARK", steps: [
    { id: "install", title: "Install reviewed dependencies", status: "DOCUMENTED", command: selectedReviewedCase.installCommand },
    { id: "prepare-assets", title: "Prepare reviewed inputs", status: "DOCUMENTED", instruction: selectedReviewedCase.dataset },
    { id: "evaluation-benchmark", title: "Evaluate against the pinned reference", status: "DOCUMENTED", instruction: "The reviewed adapter evaluates the selected model and records fresh metrics. Check the local runner to inspect the effective commands." },
  ] } : selectedCandidate ? candidateWorkflow(report, selectedCandidate) : activeWorkflow ?? report.reproductionPlan);

  function applyCandidate(options) {
    setSelectedWorkflow("evaluation");
    setQuickCommand(options.quickCommand);
    setAcceptance({ ...emptyAcceptance, ...options.evaluation, expectedText: options.expectedText, outputFile: options.outputFile,
      metricKey: options.metricKey, metricOperator: options.metricOperator, metricTarget: options.metricTarget === null ? "" : String(options.metricTarget),
      candidateReview: options.candidateReview });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
    document.getElementById("runner-title")?.focus();
  }

  function chooseQuickEntry(entry) {
    setPage("configure");
    setSelectedWorkflow("quick"); setQuickCommand(""); setAcceptance({ ...emptyAcceptance, quickEntryId: entry.id });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
    document.getElementById("runner-title")?.focus();
  }

  function applyExperiment(options) {
    setSelectedWorkflow("training"); setQuickCommand(options.quickCommand);
    setAcceptance({ ...emptyAcceptance, ...options.evaluation, experiment: options.experiment, outputFile: options.outputFile, metricKey: options.metricKey,
      metricOperator: options.metricOperator, metricTarget: String(options.metricTarget), metricTolerance: String(options.metricTolerance), expectedText: options.expectedText });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
  }

  function applyMatrix(paperMatrix) {
    setSelectedWorkflow("paper-matrix"); setQuickCommand(""); setAcceptance({ ...emptyAcceptance, paperMatrix });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
  }

  function invalidateExperiment() {
    setAcceptance((current) => ({ ...current, experiment: null }));
    setPreflight(null); setRunConfirmed(false);
  }

  const runScan = useCallback(async (targetUrl, benchmarkId, pinnedCommit) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, ...(pinnedCommit ? { pinnedCommit } : {}), ...(benchmarkId ? { executionOptions: { benchmarkId } } : {}) }),
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.error || "Scan failed");

      setReport(result);
      setPage("report");
      setImportedDraft(null);
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

  async function openExperimentVersion(draft) {
    const targetUrl = `https://github.com/${draft.repository}`;
    try {
      const result = await runScan(targetUrl, undefined, draft.commit);
      if (result.repository !== draft.repository || result.commit !== draft.commit) throw new Error("Saved source identity does not match the scan");
      setUrl(targetUrl); setImportedDraft({ ...draft, confirmed: false }); setSelectedWorkflow("training");
      setPage("configure");
      return true;
    } catch (failure) { setError(failure.message); return false; }
  }

  function submit(event) {
    event.preventDefault();
    void runScan(url).catch(() => {});
  }

  async function loadCpuEvaluation() {
    const targetUrl = "https://github.com/karpathy/micrograd";
    setUrl(targetUrl);
    try {
      await runScan(targetUrl);
      setPage("configure");
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
      setPage("configure");
      setSelectedWorkflow(benchmark.matrix ? "paper-matrix" : benchmark.training ? "training" : "evaluation");
      setQuickCommand(benchmark.matrix ? "" : benchmarkEvaluationCommand(benchmark));
      setAcceptance(benchmark.matrix ? { ...emptyAcceptance, benchmarkId: benchmark.id } : { ...emptyAcceptance, benchmarkId: benchmark.id,
        expectedText: "published-benchmark-ok", outputFile: "benchmark-result.json", metricKey: benchmark.metricKey ?? "accuracy", metricOperator: "eq",
        metricTarget: String(benchmark.reference.value), metricTolerance: String(benchmark.reference.tolerance), dataset: benchmark.dataset,
        model: benchmark.model, reference: benchmark.reference.url });
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
          executionOptions: acceptance.benchmarkId ? { benchmarkId: acceptance.benchmarkId } : acceptance.paperMatrix ? { paperMatrix: acceptance.paperMatrix } : { quickCommand, expectedText: acceptance.expectedText, outputFile: acceptance.outputFile, metricKey: acceptance.metricKey,
            metricOperator: acceptance.metricOperator, metricTarget: acceptance.metricTarget === "" ? null : Number(acceptance.metricTarget), metricTolerance: acceptance.metricOperator === "eq" ? Number(acceptance.metricTolerance) : 0,
            ...(acceptance.candidateReview ? { candidateReview: acceptance.candidateReview } : {}),
            ...(acceptance.experiment ? { experiment: acceptance.experiment } : {}),
            ...(acceptance.quickEntryId ? { quickEntryId: acceptance.quickEntryId } : {}),
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
    <div className={`shell${page === "scan" ? " home-shell" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#scan" onClick={(event) => { event.preventDefault(); setPage("scan"); }} aria-label="ReproCheck home">
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="28" height="28" fill="none"><circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" /><path d="m10 16 4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span>ReproCheck</span>
        </a>
        <nav className="workspace-nav" aria-label="Workspace">
          {[["scan", "Start scan"], ["report", "Scan report"], ["configure", "Experiment"], ["run", "Execution"], ["history", "History & comparison"]].map(([id, label]) =>
            <button type="button" key={id} aria-current={page === id ? "page" : undefined} disabled={(id === "configure" && isExample) || (id === "run" && !runJob)} onClick={() => setPage(id)}>{label}{id === "run" && runJob?.status === "RUNNING" && <span className="live-dot" />}</button>)}
        </nav>
        <span className="mode">Research workbench</span>
      </header>

      <main>
        {page === "scan" && <LandingHero />}
        <div className="workspace-heading" hidden={page === "scan"}>
          <div><p className="eyebrow">REPROCHECK / {page}</p><h1 id={page === "scan" ? "scan-workspace-title" : "workspace-title"} tabIndex={-1}>{{ scan: "From repository to evidence.", report: "Inspect the evidence", configure: "Review your experiment", run: "Execution workspace", history: "Run history & comparison" }[page]}</h1></div>
          {page !== "scan" && <button type="button" className="download-button" onClick={() => setPage("scan")}>New scan</button>}
        </div>
        {loading && <p className="source-strip" role="status">Scanning repository and collecting source evidence…</p>}
        {error && page !== "scan" && <p className="error" role="alert">{error}</p>}
        {page !== "scan" && page !== "history" && <div className="source-strip"><span>{page !== "run" && isExample ? "DEMO · not a live scan" : "PINNED SOURCE"}</span><strong>{page === "run" ? runJob?.repository : report.repository}</strong><code>{(page === "run" ? runJob?.commit : report.commit)?.slice(0, 12)}</code></div>}
        <div className="view-panel home-layout" hidden={page !== "scan"}>
        <section className="scan-panel" id="scan-form" aria-labelledby="scan-title">
          <div>
            <p className="eyebrow">Research repository readiness</p>
            <h2 id="scan-title">Check a research repository</h2>
            <p className="hint">Find a supported entry, review its inputs, and verify the result against a declared reference.</p>
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
            <details className="case-picker"><summary>Explore reviewed examples</summary><div className="case-grid">
            <button className="download-button" type="button" onClick={loadCpuEvaluation} disabled={executionBusy}>Load CPU evaluation example</button>
            <p className="hint">Small synthetic held-out dataset + trained checkpoint. Loads a reviewed command; does not start execution.</p>
            {reviewedBenchmarks.map((benchmark) => <div key={benchmark.id}>
              <button className="download-button" type="button" onClick={() => loadPublishedBenchmark(benchmark.id)} disabled={executionBusy}>Load published {benchmark.datasetName} benchmark</button>
              <p className="hint">{benchmark.matrix ? `Reviewed real-data paper matrix: ${benchmark.matrix.cells.length} pinned result cells.` : `Reviewed real-data paper case. Reference: ${benchmark.reference.value} in the pinned README.`} Does not start execution.</p>
            </div>)}
            {reviewedTrainings.map((benchmark) => <div key={benchmark.id}>
              <button className="download-button" type="button" onClick={() => loadPublishedBenchmark(benchmark.id)} disabled={executionBusy}>Load {benchmark.datasetName} training reproduction</button>
              <p className="hint">Train the original paper model once, save a new checkpoint, then evaluate against {benchmark.reference.value}. The reference is a comparison, not a promised result.</p>
            </div>)}
            </div></details>
          </form>
          <SavedExperimentImport disabled={executionBusy} onOpenVersion={openExperimentVersion} />

          {error && <p className="error" role="alert">{error}</p>}
        </section>
        <aside className="journey-card">
          <p className="eyebrow">How it works</p><h2>A clear path to your first result</h2>
          <ol className="journey-steps">
            <li><strong>Scan the source</strong><p>Inspect README instructions, files and supported Python / Make entries. No Docker required.</p></li>
            <li><strong>Review the plan</strong><p>Confirm commands, input files, dataset and output expectations before execution.</p></li>
            <li><strong>Run in Docker</strong><p>Execute the selected workflow locally with explicit resource limits and live logs.</p></li>
            <li><strong>Compare the evidence</strong><p>Separate process completion, output checks and reference matching. Keep the record for replay.</p></li>
          </ol>
          <p className="runner-note">A passing check is not full-paper reproduction. Only the reviewed experiment and declared conditions are verified.</p>
          <button type="button" className="download-button" onClick={() => setPage("report")}>{isExample ? "Preview a clearly labelled demo report" : "Return to latest report"}</button>
        </aside>
        </div>

        <div className="view-panel" hidden={page !== "report"}>

        {!isExample && !acceptance.benchmarkId && <SuggestedEntry key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onChoose={chooseQuickEntry} />}
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

        {!isExample && <details className="advanced-evidence"><summary>Paper provenance and protocol lock</summary><PaperProvenance report={report} /><ProtocolLock report={report} /></details>}
        {!isExample && <div className="next-action"><p>Review the source evidence, then configure the workflow and its acceptance conditions.</p><button type="button" onClick={() => setPage("configure")}>Configure experiment →</button></div>}
        </div>
        <div className="view-panel configure-layout" hidden={page !== "configure"}>
        {!isExample && !acceptance.benchmarkId && <details className="matrix-options"><summary>Advanced · multi-experiment paper matrix</summary><PaperMatrix key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onApply={applyMatrix} /></details>}

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
                      <p className="plan-missing">This step was not automatically recognized. Review the source instructions before proceeding.</p>
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
                <li className="workflow-empty">{activeWorkflow?.id === "quick" && report.quickEntries?.length ? "Choose an entry in Start here above to review it in Quick." : "No matching entry point was automatically recognized. Check the README and source files."}{activeWorkflow?.id === "evaluation" && " You can explicitly supply and review an Evaluation entry below; it is not a discovered README command."}</li>
              )}
            </ol>
          </section>
        )}

        {!isExample && report.evaluationDraft && !acceptance.benchmarkId && selectedWorkflow !== "paper-matrix" && <CandidateConfig key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onApply={applyCandidate} />}

        {!isExample && activeWorkflow && (
          <section className="runner execution-config" aria-labelledby="runner-title">
            <div className="runner-heading">
              <div>
                <p className="eyebrow">Isolated execution preview</p>
                <h2 id="runner-title" tabIndex={-1}>Check before running unknown code</h2>
                <p>Re-scan the pinned commit and inspect the local Docker runner.</p>
              </div>
              <button type="button" onClick={checkPreflight} disabled={executionBusy || (activeWorkflow.id === "quick" && report.quickEntries?.length > 0 && !acceptance.quickEntryId) || (acceptance.candidateReview && !acceptance.candidateReview.confirmed) || (activeWorkflow.id === "training" && !acceptance.benchmarkId && !acceptance.experiment)}>
                {preflightLoading ? "Checking…" : "Check local runner"}
              </button>
            </div>

            {preflightError && <p className="runner-error" role="alert">{preflightError}</p>}
            {activeWorkflow.id === "training" && !acceptance.benchmarkId && <>
              <ExperimentConfig key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onApply={applyExperiment} onInvalidate={invalidateExperiment} importedDraft={importedDraft} />
              <p className="hint" role="status">{acceptance.experiment ? "Reviewed experiment applied. Check local runner to inspect every effective command before execution." : "Review and apply an experiment configuration to enable the runner check."}</p>
            </>}
            {acceptance.benchmarkId && <div className="run-comparison">
              <h3>{selectedReviewedCase.title}</h3>
              <p>{selectedReviewedCase.dataset}</p>
              <p>{selectedReviewedCase.model}</p>
              {selectedReviewedCase.training && <p className="runner-note">{selectedReviewedCase.training.scope}</p>}
              <p><a href={selectedReviewedCase.reference.url} target="_blank" rel="noreferrer">{selectedReviewedCase.matrix ? `Pinned Table 1 source · ${selectedReviewedCase.matrix.cells.length} result cells` : `Pinned reference: ${selectedReviewedCase.metricKey ?? "accuracy"} ${selectedReviewedCase.reference.value} · tolerance ${selectedReviewedCase.reference.tolerance}`}</a></p>
              <p className="hint">{selectedReviewedCase.matrix ? `Fixed output checks: published-matrix-ok · fresh ${selectedReviewedCase.matrix.outputFile} · all ${selectedReviewedCase.matrix.cells.length} cells match at four decimals.` : `Fixed output checks: published-benchmark-ok · fresh benchmark-result.json · ${selectedReviewedCase.metricKey ?? "accuracy"} = ${selectedReviewedCase.reference.value} ± ${selectedReviewedCase.reference.tolerance}.`}</p>
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
                    <li key={step.id}><span>{step.title}</span>{preflight.executionOptions.experiment?.inputs?.[step.id]?.length > 0 && <p>Required input files: {preflight.executionOptions.experiment.inputs[step.id].join(", ")}</p>}<code className="command">{step.effectiveCommand ?? step.command}</code></li>
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
                  {runLoading ? "Starting…" : activeWorkflow.id === "training" ? "Run Training reproduction" : activeWorkflow.id === "evaluation" ? "Run Evaluation" : activeWorkflow.id === "paper-matrix" ? "Run paper matrix" : "Run Quick verification"}
                </button>
                {!preflight.runnable && (
                  <p className="runner-note">{preflight.reason ?? "The workflow is not ready to execute."}</p>
                )}
              </div>
            )}
          </section>
        )}
        </div>
        <div className="view-panel" hidden={page !== "run"}>
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
                {["FAILED", "TIMED_OUT"].includes(runJob.status) && runJob.workflowId === "paper-matrix" && !runJob.replayOf && (
                  <button type="button" onClick={() => startExecution("readme", runJob)} disabled={executionBusy || !runConfirmed}>Retry complete paper workflow</button>
                )}
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
        </div>
        <div className="view-panel" hidden={page !== "history"}>
        <section className="runner run-history" aria-labelledby="history-title">
          <div className="runner-heading">
            <div><p className="eyebrow">Local evidence archive</p><h2 id="history-title">Recent executions</h2>
              <p>Records stay on this computer and survive server restarts. They are not uploaded to GitHub.</p></div>
            <button className="download-button" type="button" onClick={refreshHistory}>Refresh history</button>
          </div>
          {historyError && <p className="runner-note" role="status">{historyError}</p>}
          <p className="hint">Open a saved record to inspect its evidence or review a frozen replay. Replay comparisons separate changed inputs from metric acceptance.</p>
          {history.length === 0 && !historyError && <div className="empty-state"><h3>No saved executions yet</h3><p>Scan a repository and complete a reviewed run to build your local evidence archive.</p><button type="button" className="download-button" onClick={() => setPage("scan")}>Start with a repository</button></div>}
          <ul className="history-list">
            {history.map((entry) => <li key={entry.id}>
              <div><strong>{entry.repository}</strong><p className="hint">{entry.workflowId ?? "quick"} · Execution: {entry.status} · Output checks: {entry.verificationStatus}{entry.evaluationStatus && ` · Evaluation: ${entry.evaluationStatus}`} · commit {entry.commit.slice(0, 7)} · {new Date(entry.startedAt).toLocaleString()}</p></div>
              <button className="download-button" type="button" onClick={() => openHistory(entry.id)}>View record</button>
            </li>)}
          </ul>
          {archivedJob && <div className="run-log" id="archived-execution" tabIndex={-1} aria-label="Saved execution details">
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
            <ol>{replayPreview.automatedSteps.map((step) => <li key={step.id}><strong>{step.title}</strong>{replayPreview.executionOptions.experiment?.inputs?.[step.id]?.length > 0 && <p>Required input files: {replayPreview.executionOptions.experiment.inputs[step.id].join(", ")}</p>}<code className="command">{step.command}</code></li>)}</ol>
            <details><summary>Locked dependencies and output expectations</summary><pre>{JSON.stringify({ dependencies: replayPreview.recipe.dependencies, expectations: replayPreview.executionOptions }, null, 2)}</pre></details>
            {replayPreview.recipe.warnings.map((warning) => <p className="runner-note" key={warning}>{warning}</p>)}
            {!replayPreview.runnable && <p className="runner-error" role="alert">{replayPreview.reason}</p>}
            <label className="runner-confirm"><input type="checkbox" checked={replayConfirmed} disabled={executionBusy}
              onChange={(event) => setReplayConfirmed(event.target.checked)} />I reviewed this frozen recipe and understand it re-runs untrusted code with network access in a new temporary container.</label>
            <button type="button" disabled={!replayPreview.runnable || !replayConfirmed || executionBusy} onClick={startReplay}>{runLoading ? "Starting…" : "Replay frozen recipe"}</button>
          </>}
        </section>}
        </div>
      </main>
      <footer className="workspace-footer"><span>ReproCheck · Evidence before conclusions</span><span>Public Python repositories · Local Docker execution</span></footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
