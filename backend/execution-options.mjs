// Trusted execution-option validation shared with the Docker runner.
import { validateExecutionOptions, reviewedCaseById } from '../runner.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const value = JSON.parse(input);
  const options = validateExecutionOptions(value.executionOptions);
  const pinnedCommit = options.benchmarkId ? reviewedCaseById.get(options.benchmarkId).commit : options.experiment?.commit ?? value.pinnedCommit;
  if (value.pinnedCommit !== undefined && value.pinnedCommit !== pinnedCommit) throw new Error('Conflicting pinned commits');
  console.log(JSON.stringify({ pinnedCommit }));
} catch (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
