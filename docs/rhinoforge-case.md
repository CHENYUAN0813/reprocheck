# RhinoForge: selected CPU software checks

This case checks release/version and dependency-release logic in [HUIXI-AI/RhinoForge](https://github.com/HUIXI-AI/RhinoForge/tree/75a70726552e40715de1a728ad97a7514b67c2dd). It does **not** run a robot, GPU/board inference, model training or reproduce RhinoVLA results.

## Fixed inputs

- Source commit: `75a70726552e40715de1a728ad97a7514b67c2dd`.
- Upstream image recipe: `scripts/ci/host-image/Dockerfile` and its locked requirements, unchanged.
- Build override: `DEBIAN_MIRROR=https://deb.debian.org` (package mirror only).
- Recorded local image: `sha256:1feceef627d3892eb001a19fd762ed582dba06b8f3ee16e90c7d2fde1787edc2`.
- Observed runtime: Python 3.12.16; the upstream base tag is mutable, so rebuilding later need not produce the same image ID.
- Limits: two CPUs, 2048 MiB, ten minutes, offline execution; no GPU or model downloads.

The updated plan builds this image through the webpage. Import `examples/rhinoforge-batch.json`, review its Dockerfile link and build arguments, confirm the networked build, then run. The total fetch/build/test deadline is 30 minutes. Previously built matching plans are reused.

For comparison, the equivalent optional terminal preparation is:

```sh
git clone https://github.com/HUIXI-AI/RhinoForge.git rhinoforge-source
git -C rhinoforge-source checkout --detach 75a70726552e40715de1a728ad97a7514b67c2dd
docker build --build-arg DEBIAN_MIRROR=https://deb.debian.org -t reprocheck-rhinoforge-host:75a7072 rhinoforge-source/scripts/ci/host-image
```

Image preparation uses network access and downloads CPU PyTorch and other dependencies. The recorded final image has approximately 716 MB of uncompressed image data; build cache and Docker's virtual disk can occupy more. This is not a promise of total disk consumption or build duration.

Follow the [batch page instructions](batch-test-plans.md), import `examples/rhinoforge-batch.json`, and keep **Build from repository Dockerfile** selected; no terminal image preparation is required. The executor uses the upstream command:

```sh
bash scripts/ci/run_host_tests.sh tests/test_release_version.py tests/test_dependency_release.py
```

The plan sets `CI_PROJECT_DIR=/tmp/project` and `CI_JOB_ID=reprocheck`. The official script generates `test-results/host-runtime.xml`.

## Observed results

The integrated build run `a09c458b-b5d0-4589-9e25-758cfda226a1` built from the pinned archive and then passed all 39 tests. This is additional evidence; earlier local-image runs below remain unchanged.

After fixing stable archive timestamps, run `203cf227-757f-4ce4-9705-0460ce548d5a` built the environment and passed 39 tests. Run `d41aef18-d95e-4863-8bab-2ec1ef065c7f` reused exactly the same context hash and image ID, and reported 38 passes / 1 failure. The earlier webpage run `b95bab8f-a5b7-4588-b7a2-3967f6f5f2be` likewise reported 38 passes / 1 failure. Build success and test success remain separate; these runs do not establish that the upstream tests are stable.

| Local run | Result |
| --- | --- |
| `460c2d18-52b4-40f6-bb06-7dbc79c7919d` | 39 tests: 38 passed, 1 failed. CMake rebuild did not update the expected release version from rc1 to rc2. |
| `3c59703d-5fd8-4d67-9073-02952f23b1e4` | Same source and image: 39 passed, 0 failed/errors/skipped. |
| `9cc2473b-6371-44bc-a009-b8563f6ff7cc` | Started from the web UI: 39 passed; original JUnit download verified. Pytest reported 4.99 seconds (not including source fetch or image preparation). |
| `022b6d77-46bb-453c-ad5d-26ab24cd6e6b` | Independent `pytest-dev/iniconfig` commit `a9e0ad14bcd0d9d3b68d2b699ce38399cbe64fdd`: 54 passed through the same configurable executor. |

The failed RhinoForge case is `test_existing_build_reconfigures_after_version_or_lock_changes`. Its cause has **not** been established. A passing rerun is not evidence that the earlier failure was fixed; retain both results when discussing reliability. No upstream test or expected value was changed.

An integration issue was fixed in ReproCheck: Windows Git line-ending settings could change archived shell scripts to CRLF. Source archiving now explicitly uses LF; an automated regression covers this.

Run IDs refer to local history, not public hosted evidence. Full records and raw JUnit XML remain under the ignored `.reprocheck/` directory on the machine that ran them. Export evidence from the UI when sharing; these records are not automatically uploaded to GitHub.
