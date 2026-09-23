import capacityBenchmark from "./sequential-capacity-probes.json" with { type: "json" };
import { reviewedBenchmarks as bthowenBenchmarks, reviewedTrainings as bthowenTrainings } from "./bthowen-cases.mjs";

const withBthowenRuntime = (benchmark) => ({ ...benchmark, adapter: "bthowen", image: "python:3.11" });
export const reviewedBenchmarks = [...bthowenBenchmarks.map(withBthowenRuntime), capacityBenchmark];
export const reviewedTrainings = bthowenTrainings.map(withBthowenRuntime);
export const reviewedBenchmark = reviewedBenchmarks[0];
export const reviewedTraining = reviewedTrainings[0];
export const reviewedCases = [...reviewedBenchmarks, ...reviewedTrainings];
export const reviewedCaseById = new Map(reviewedCases.map((entry) => [entry.id, entry]));
