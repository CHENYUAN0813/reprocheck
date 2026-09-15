import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import cpuEvaluationSource from "../examples/evaluate-micrograd.py?raw";
import publishedBenchmark from "../examples/bthowen-iris.json";
import publishedEvaluationSource from "../examples/evaluate-bthowen.py?raw";
import { candidateOptions, candidateWorkflow } from "../evaluation-config.mjs";

const emptyAcceptance = { expectedText: "", outputFile: "", metricKey: "", metricOperator: "gte", metricTarget: "", metricTolerance: "0", dataset: "", model: "", reference: "", assetsInEntry: false };
const cpuEvaluationCommand = `python -c 'exec(${JSON.stringify(cpuEvaluationSource).replaceAll("'", "'\"'\"'")})'`;
const publishedEvaluationCommand = `python -c 'exec(${JSON.stringify(publishedEvaluationSource).replaceAll("'", "'\"'\"'")})' evaluate`;

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

function CandidateConfig({ report, disabled, onApply }) {
  const draft = report.evaluationDraft;
  function selections(entryId) {
    const related = draft.references.filter((reference) => reference.entryId === entryId);
    const outputs = draft.outputs.filter((output) => output.entryIds.includes(entryId));
    return { entryId, referenceId: related.length === 1 ? related[0].id : draft.references.length === 1 && (!draft.references[0].entryId || draft.references[0].entryId === entryId) ? draft.references[0].id : null,
      outputId: outputs.length === 1 ? outputs[0].id : null, confirmed: false };
  }
  const [review, setReview] = useState(() => selections(draft.entries[0]?.id ?? ""));
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
    {draft.entries.length === 0 ? <p className="runner-note">No suitable entry candidate was found in the sampled files. Supply a custom Evaluation below; no command or benchmark is invented.</p> : <fieldset className="run-options" disabled={disabled}>
      <legend>Source-backed candidate choices</legend>
      <label>Candidate entry<select value={review.entryId} onChange={(event) => setReview(selections(event.target.value))}>
        {draft.entries.map((entry) => <option value={entry.id} key={entry.id}>{entry.command}{entry.origin ? " · inferred, review arguments" : ""}</option>)}
      </select></label>
      {entry && <p className="evidence"><span>Entry source</span><EvidenceLink report={report} evidence={entry.evidence} /></p>}
      {entry?.note && <p className="runner-note">{entry.note}</p>}
      <label>Result capture<select value={review.outputId ?? ""} onChange={(event) => setReview((current) => ({ ...current, outputId: event.target.value || null }))}>
        <option value="">Not selected — complete manually</option>
        {draft.outputs.filter((output) => output.entryIds.includes(review.entryId)).map((output) => <option value={output.id} key={output.id}>{output.kind === "stdout" ? `Labelled stdout: ${output.label} · ${output.unit}` : `JSON: ${output.path}`}</option>)}
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
        {output?.kind === "stdout" && <p className="hint">A generic adapter runs the original command and records its actual printed score as JSON. It never substitutes the reference value; missing/duplicate scores fail.</p>}
        <button type="button" onClick={() => onApply(options)}>Use candidates in Evaluation form</button>
      </>}
    </fieldset>}
    <details><summary>Candidate sources and coverage limits</summary><pre className="evaluation-source">{JSON.stringify(draft, null, 2)}</pre></details>
    <p className="runner-note">README values may be example output. You must confirm the selected dataset, split, model and metric correspond; they are not automatically verified paper claims.</p>
  </section>;
}

function ExecutionEvidence({ job, onPrepareReplay, replayDisabled }) {
  const labels = { VERIFIED: "Configured checks passed", FAILED: "Output checks failed", INCOMPLETE: "Verification incomplete",
    NOT_CONFIGURED: "No output checks configured", PENDING: "Waiting for execution" };
  return (
    <div className="execution-evidence">
      <h3>Output verification · {labels[job.verification?.status] ?? "Not available"}</h3>
      <p className="hint">Execution success alone does not prove paper reproducibility. These checks validate only the expectations you supplied.</p>
      {job.persistenceError && <p className="runner-error" role="alert">{job.persistenceError} — download the evidence now.</p>}
      {job.logTruncated && <p className="runner-note">Only the last 200,000 log characters are retained.</p>}
      <ul className="verification-checks">
        {job.verification?.checks?.map((check) => (
          <li key={check.id}><strong>{check.status}</strong> · {check.id}: <code>{check.expected}</code>
            {check.observed && <pre>{JSON.stringify(check.observed, null, 2)}</pre>}
          </li>
        ))}
      </ul>
      {job.evaluation && <div className="run-comparison">
        <h3>Evaluation report · {job.evaluation.status.replaceAll("_", " ")}</h3>
        <p className="hint">{job.benchmark ? "Reviewed Iris software case: input hashes and the pinned README row must pass checks before entry and at completion. This is not full-paper reproduction or a security attestation." : "Dataset, model and reference source below are user declarations, not independently verified paper claims."}</p>
        <dl className="evaluation-summary">
          <dt>Dataset / split</dt><dd>{job.evaluation.dataset}</dd>
          <dt>Model / checkpoint</dt><dd>{job.evaluation.model}</dd>
          <dt>Reference source</dt><dd>{job.benchmark ? <a href={job.benchmark.reference.url} target="_blank" rel="noreferrer">Pinned README · Table 3 · Iris</a> : job.evaluation.reference}</dd>
          <dt>Observed / reference</dt><dd>{job.evaluation.observedValue ?? "unknown"} / {job.evaluation.referenceValue} · {job.evaluation.metricKey}</dd>
          <dt>Difference / tolerance</dt><dd>{job.evaluation.delta ?? "unknown"} / {job.evaluation.tolerance} · condition {job.evaluation.operator}</dd>
        </dl>
        {job.benchmark && <>
          <p className="runner-note">{job.benchmark.compatibility.note}</p>
          <p className="hint">Scope: {job.benchmark.reference.scope}</p>
          <details><summary>Dataset, checkpoint, code hashes and reference-row evidence</summary><pre>{JSON.stringify({ assets: job.assets, reference: job.referenceEvidence }, null, 2)}</pre></details>
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
  const displayedPlan = selectedCandidate ? candidateWorkflow(report, selectedCandidate) : activeWorkflow ?? report.reproductionPlan;

  function applyCandidate(options) {
    setSelectedWorkflow("evaluation");
    setQuickCommand(options.quickCommand);
    setAcceptance({ ...emptyAcceptance, ...options.evaluation, expectedText: options.expectedText, outputFile: options.outputFile,
      metricKey: options.metricKey, metricOperator: options.metricOperator, metricTarget: options.metricTarget === null ? "" : String(options.metricTarget),
      candidateReview: options.candidateReview });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
    document.getElementById("runner-title")?.focus();
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

  async function loadPublishedBenchmark() {
    const targetUrl = `https://github.com/${publishedBenchmark.repository}`;
    setUrl(targetUrl);
    try {
      await runScan(targetUrl, publishedBenchmark.id);
      setSelectedWorkflow("evaluation");
      setQuickCommand(publishedEvaluationCommand);
      setAcceptance({ ...emptyAcceptance, benchmarkId: publishedBenchmark.id, expectedText: "published-benchmark-ok", outputFile: "benchmark-result.json",
        metricKey: "accuracy", metricOperator: "eq", metricTarget: String(publishedBenchmark.reference.value), metricTolerance: "0",
        dataset: publishedBenchmark.dataset, model: publishedBenchmark.model, reference: publishedBenchmark.reference.url });
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
            evaluation: activeWorkflow.id === "evaluation" ? { dataset: acceptance.dataset, model: acceptance.model, reference: acceptance.reference, assetsInEntry: acceptance.assetsInEntry } : null },
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
            <button className="download-button" type="button" onClick={loadPublishedBenchmark} disabled={executionBusy}>Load published Iris benchmark</button>
            <p className="hint">Real UCI data + paper's pretrained model + original evaluation entry. Reference: 98% in the pinned README; explicit CPU compatibility profile. Does not start execution.</p>
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
              <button type="button" onClick={checkPreflight} disabled={executionBusy || (acceptance.candidateReview && !acceptance.candidateReview.confirmed)}>
                {preflightLoading ? "Checking…" : "Check local runner"}
              </button>
            </div>

            {preflightError && <p className="runner-error" role="alert">{preflightError}</p>}
            {acceptance.benchmarkId && <div className="run-comparison">
              <h3>{publishedBenchmark.title}</h3>
              <p>{publishedBenchmark.dataset}</p>
              <p>{publishedBenchmark.model}</p>
              <p><a href={publishedBenchmark.reference.url} target="_blank" rel="noreferrer">Pinned reference: accuracy 0.98 · exact numeric match</a></p>
              <p className="hint">Fixed output checks: published-benchmark-ok · fresh benchmark-result.json · accuracy = 0.98 ± 0.</p>
              <p className="runner-note">{publishedBenchmark.compatibility.note}</p>
              <p className="hint">Commands and expectations are fixed for this reviewed case. Choose another workflow or scan again to return to custom Evaluation.</p>
              <details><summary>Review benchmark manifest and adapter source</summary><pre className="evaluation-source">{JSON.stringify(publishedBenchmark, null, 2)}{"\n\n"}{publishedEvaluationSource}</pre></details>
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
                  <label>JSON metric key (optional)<input value={acceptance.metricKey} maxLength={100} disabled={optionsLocked}
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
                  <p className="hint">Required: a new/changed JSON file and numeric metric. Use 0.95 for 95% if the output uses fractions. Context is user-declared; CPU/2 GB/10 minute limits still apply.</p>
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
                  {runLoading ? "Starting…" : activeWorkflow.id === "evaluation" ? "Run Evaluation" : "Run Quick verification"}
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
                <pre>{runJob.log || "Starting isolated container…"}</pre>
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
            <pre>{archivedJob.log || "No log captured."}</pre>
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
