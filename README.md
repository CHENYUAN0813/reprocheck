# ReproCheck

ReproCheck checks public Python research repositories for reproducibility problems.

It scans the complete repository file tree at a specific commit and reads the root README.

## Usage

`node scan.mjs https://github.com/owner/repository`

For structured JSON output:

`node scan.mjs https://github.com/owner/repository --json`

Each check includes evidence and a suggestion when action is needed.

## Web interface

`npm run dev`

Open `http://127.0.0.1:5173` and submit a public GitHub repository URL.

## Self-test

`node scan.mjs --self-test`

## Current checks

- README exists
- Dependency file exists
- Python version is pinned
- Install command exists in README
- Run command exists in README
- License file exists
- Test entry exists

## Current limitations

- Public GitHub repositories only
- Only README content is analyzed; other files are checked by path
- Does not execute repository code
