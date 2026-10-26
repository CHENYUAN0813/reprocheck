// CLI compatibility entry: all scanning rules live in Python.
import { startScanService } from './scan-service.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function scan(input, token = process.env.GITHUB_TOKEN, pinnedCommit) {
  const service = await startScanService({ token });
  try {
    const result = await service.request({ url: input, ...(pinnedCommit === undefined ? {} : { pinnedCommit }) });
    if (result.status !== 200) throw new Error(result.body.error);
    return result.body;
  } finally { await service.close(); }
}

function strictExitCode(status) {
  return status === "READY_FOR_REVIEW" ? 0 : 1;
}

function standalonePlan(report) {
  return {
    repository: report.repository,
    commit: report.commit,
    ...report.reproductionPlan,
    experimentParameters: report.experimentParameters,
    entrypoints: report.entrypoints,
    workflows: report.workflows,
    evaluationDraft: report.evaluationDraft,
    paperProvenance: report.paperProvenance,
    paperWorkflowDraft: report.paperWorkflowDraft,
    protocolLock: report.protocolLock,
    paperMatrixDraft: report.paperMatrixDraft,
    quickEntries: report.quickEntries,
    recommendedQuickEntryId: report.recommendedQuickEntryId,
  };
}

function printReport(report) {
  for (const check of report.checks) {
    console.log(`${check.status.padEnd(6)}${check.message}`);
  }

  console.log(`Files scanned: ${report.filesScanned}`);
  console.log(
    `Status: ${report.status} (failures: ${report.summary.failures}, warnings: ${report.summary.warnings})`,
  );
  console.log(`Commit: ${report.commit}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    await import('./test-fastapi.mjs');
    return;
  }
  const input = args.find((arg) => !arg.startsWith("--"));

  if (!input) {
    console.error("用法：node scan.mjs https://github.com/owner/repo [--json|--plan] [--strict]");
    process.exitCode = 1;
  } else {
    scan(input, process.env.GITHUB_TOKEN)
      .then((report) => {
        if (args.includes("--plan")) {
          console.log(JSON.stringify(standalonePlan(report), null, 2));
        } else if (args.includes("--json")) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printReport(report);
        }

        if (args.includes("--strict")) {
          process.exitCode = strictExitCode(report.status);
        }
      })
      .catch((error) => {
        console.error(`ERROR ${error.message}`);
        process.exitCode = 1;
      });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
