// Shared, trusted report rules during the Python migration; never evaluates repository code.
import { buildEvaluationDraft, discoverPaperProvenance, suggestCandidate } from '../evaluation-config.mjs';
import { buildPaperWorkflowDraft } from '../paper-workflow.mjs';
import { buildProtocolLock } from '../protocol-lock.mjs';
import { buildPaperMatrixDraft } from '../paper-matrix.mjs';
import { reconcileWorkflowFindings } from '../scan.mjs';
import { validateExecutionOptions, reviewedCaseById } from '../runner.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const data = JSON.parse(input);
  if (data.action === 'validate') {
    const value = data.input;
    const options = validateExecutionOptions(value.executionOptions);
    const pinnedCommit = options.benchmarkId ? reviewedCaseById.get(options.benchmarkId).commit : options.experiment?.commit ?? value.pinnedCommit;
    if (value.pinnedCommit !== undefined && value.pinnedCommit !== pinnedCommit) throw new Error('Conflicting pinned commits');
    console.log(JSON.stringify({ pinnedCommit }));
  } else if (data.action === 'enrich') {
    const { report, readme, readmeText, codeFiles, filePaths, makefile, makefileText, lock } = data;
    report.evaluationDraft = buildEvaluationDraft({ readme, readmeText, entrypoints: report.entrypoints, files: codeFiles, filePaths });
    report.evaluationDraft.suggestion = suggestCandidate(report);
    report.paperProvenance = discoverPaperProvenance({ readme, readmeText, evaluationDraft: report.evaluationDraft });
    report.paperWorkflowDraft = buildPaperWorkflowDraft({ provenance: report.paperProvenance, makefile, makefileText, filePaths });
    reconcileWorkflowFindings(report);
    report.protocolLock = buildProtocolLock({ ...lock, report, readme, makefile });
    report.paperMatrixDraft = buildPaperMatrixDraft(report);
    console.log(JSON.stringify(report));
  } else throw new Error('Unknown report operation');
} catch (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
