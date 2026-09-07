import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

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
      id: "dependencies",
      status: "PASS",
      message: "Dependencies found: requirements.txt",
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
  ],
};

function App() {
  const [url, setUrl] = useState("https://github.com/example-lab/vision-baseline");
  const [report, setReport] = useState(exampleReport);
  const [isExample, setIsExample] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.error || "Scan failed");

      setReport(result);
      setIsExample(false);
    } catch (scanError) {
      setError(scanError.message || "Unable to scan this repository");
    } finally {
      setLoading(false);
    }
  }

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
                        <code>
                          {check.evidence.file}
                          {check.evidence.line ? `:${check.evidence.line}` : ""}
                        </code>
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
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
