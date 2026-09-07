# ReproCheck

ReproCheck checks public Python research repositories for reproducibility problems.

## Usage

`node scan.mjs https://github.com/owner/repository`

## Self-test

`node scan.mjs --self-test`

## Current checks

- README exists
- Dependency file exists
- Python version is pinned

## Current limitations

- Public GitHub repositories only
- Checks root-level files only
- Does not execute repository code