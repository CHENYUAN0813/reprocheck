export const rumorCase = {
  id: 'rumor-control', name: 'Rumor Control · React + TypeScript + Vite',
  repository: 'CHENYUAN0813/rumor-control',
  url: 'https://github.com/CHENYUAN0813/rumor-control',
  commit: 'b4775b30554f00b1deb9051279fc4facbd7d8ba0',
  scope: 'Pinned game acceptance: investigation, evidence submission, offline fallback and save/reload. Live Ollama inference is not tested.',
  commands: ['npm ci --no-audit --no-fund', 'npm test', 'npm run lint', 'npm run build', 'npm run dev -- --host 0.0.0.0 --port 5173 --strictPort'],
  checks: ['Game loads at round zero', 'Investigation obtains evidence and advances round', 'Submission falls back when Ollama is unavailable', 'Game state survives reload'],
};
