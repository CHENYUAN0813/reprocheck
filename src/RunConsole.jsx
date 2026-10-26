import { useLanguage } from "./language.jsx";
import { useEffect, useRef, useState } from "react";

export function RunConsole({ text, job, active = true }) {
  const { t } = useLanguage();
  const [follow, setFollow] = useState(job.status === "RUNNING");
  const log = useRef(null);
  useEffect(() => {
    if (follow && active && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [text, follow, active]);
  return <div className="execution-console-grid">
    <section className="terminal-panel" aria-label={t("Execution log")}>
      <div className="terminal-toolbar"><strong><span aria-hidden="true">● ● ●</span>{t(" Execution log")}</strong>
        <label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />{t(" Follow output")}</label>
      </div>
      <pre ref={log} tabIndex={0} aria-label={t("Captured log output")} onScroll={() => {
        const node = log.current;
        if (follow && node && node.scrollHeight - node.scrollTop - node.clientHeight > 48) setFollow(false);
      }}>{text || t(job.status === "RUNNING" ? "Waiting for container output…" : "No log captured.")}</pre>
      <p className="hint">{t(job.logTruncated ? "Display log truncated; structured verification is stored separately." : "Captured command output. Verification is shown separately below.")}</p>
    </section>
    <aside className="execution-context" aria-label={t("Recorded run context")}>
      <p className="eyebrow">{t("Run context")}</p><h3>{t("Recorded configuration")}</h3>
      <dl><dt>{t("Workflow")}</dt><dd>{t(job.workflowId ?? "Not captured")}</dd>
        <dt>{t(job.commit?.startsWith('sha256:') ? 'Source snapshot SHA-256' : 'Source commit')}</dt><dd><code>{job.commit}</code></dd>
        <dt>{t("CPU limit")}</dt><dd>{t(job.limits?.cpus ?? "Not captured")}</dd>
        <dt>{t("Memory limit")}</dt><dd>{t(job.limits?.memory ?? "Not captured")}</dd>
        <dt>{t("Time limit")}</dt><dd>{t(job.limits?.timeoutMinutes == null ? "Not captured" : `${job.limits.timeoutMinutes} minutes`)}</dd>
        <dt>{t("Replay baseline")}</dt><dd>{t(job.replayOf ?? "Not a replay")}</dd></dl>
      <p className="hint">{t("These are recorded limits and identifiers, not live resource measurements.")}</p>
    </aside>
  </div>;
}
