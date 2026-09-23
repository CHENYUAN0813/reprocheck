import irisBenchmark from "./bthowen-iris.json" with { type: "json" };
import irisTraining from "./bthowen-training.json" with { type: "json" };
import paperCases from "./bthowen-paper-cases.json" with { type: "json" };

function trainingCase(benchmark, profile) {
  return { ...benchmark, id: profile.id, title: profile.title, model: profile.model,
    reference: { ...benchmark.reference, scope: profile.scope },
    assets: benchmark.assets.filter((asset) => asset.role !== "checkpoint"), training: profile };
}

const sharedAssets = irisBenchmark.assets.filter((asset) => !["dataset", "checkpoint"].includes(asset.role));
const extraBenchmarks = paperCases.map(({ datasetAsset, checkpointAsset, training, ...entry }) => ({
  ...irisBenchmark, ...entry, assets: [datasetAsset, checkpointAsset, ...sharedAssets],
}));

export const reviewedBenchmark = irisBenchmark;
export const reviewedTraining = trainingCase(irisBenchmark, irisTraining);
export const reviewedBenchmarks = [reviewedBenchmark, ...extraBenchmarks];
export const reviewedTrainings = [reviewedTraining, ...extraBenchmarks.map((benchmark, index) => trainingCase(benchmark, paperCases[index].training))];
export const reviewedCases = [...reviewedBenchmarks, ...reviewedTrainings];
export const reviewedCaseById = new Map(reviewedCases.map((entry) => [entry.id, entry]));
