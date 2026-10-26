import { useEffect, useRef, useState } from "react";

export function RunConsole({ text, job, active = true }) {
  const [follow, setFollow] = useState(job.status === "RUNNING");
  const log = useRef(null);
  useEffect(() => {
    if (follow && active && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [text, follow, active]);
  return <div className="execution-console-grid">
    <section className="terminal-panel" aria-label="Execution log">
      <div className="terminal-toolbar"><strong><span aria-hidden="true">● ● ●</span> Execution log</strong>
        <label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> Follow output</label>
      </div>
      <pre ref={log} tabIndex={0} aria-label="Captured log output" onScroll={() => {
        const node = log.current;
        if (follow && node && node.scrollHeight - node.scrollTop - node.clientHeight > 48) setFollow(false);
      }}>{text || (job.status === "RUNNING" ? "Waiting for container output…" : "No log captured.")}</pre>
      <p className="hint">{job.logTruncated ? "Display log truncated; structured verification is stored separately." : "Captured command output. Verification is shown separately below."}</p>
    </section>
    <aside className="execution-context" aria-label="Recorded run context">
      <p className="eyebrow">Run context</p><h3>Recorded configuration</h3>
      <dl><dt>Workflow</dt><dd>{job.workflowId ?? "Not captured"}</dd>
        <dt>Source commit</dt><dd><code>{job.commit}</code></dd>
        <dt>CPU limit</dt><dd>{job.limits?.cpus ?? "Not captured"}</dd>
        <dt>Memory limit</dt><dd>{job.limits?.memory ?? "Not captured"}</dd>
        <dt>Time limit</dt><dd>{job.limits?.timeoutMinutes == null ? "Not captured" : `${job.limits.timeoutMinutes} minutes`}</dd>
        <dt>Replay baseline</dt><dd>{job.replayOf ?? "Not a replay"}</dd></dl>
      <p className="hint">These are recorded limits and identifiers, not live resource measurements.</p>
    </aside>
  </div>;
}
