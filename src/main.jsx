import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

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

function App() {
  const [url, setUrl] = useState("");
  const [report, setReport] = useState(exampleReport);
  const [isExample, setIsExample] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState("quick");
  const activeWorkflow = report.workflows?.find((workflow) => workflow.id === selectedWorkflow)
    ?? report.workflows?.[0]
    ?? null;
  const displayedPlan = activeWorkflow ?? report.reproductionPlan;

  const runScan = useCallback(async (targetUrl) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.error || "Scan failed");

      setReport(result);
      setIsExample(false);
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
              <button type="submit" disabled={loading}>
                {loading ? "Scanning…" : "Scan repository"}
              </button>
            </div>
            <p className="hint">Public repositories only · Results pinned to a commit</p>
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
                  {activeWorkflow?.title ?? "From repository to first run"}
                </h2>
                {report.workflows && (
                  <div className="workflow-tabs" role="tablist" aria-label="Reproduction workflow">
                    {report.workflows.map((workflow) => (
                      <button
                        className={`workflow-tab${workflow.id === activeWorkflow?.id ? " workflow-tab-active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={workflow.id === activeWorkflow?.id}
                        onClick={() => setSelectedWorkflow(workflow.id)}
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
                <li className="workflow-empty">No matching entry point was found in the README.</li>
              )}
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
