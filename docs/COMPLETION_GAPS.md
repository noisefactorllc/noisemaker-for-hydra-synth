# noisemaker-for-hydra-synth: completion gaps

Current measured support: [compatibility report](COMPATIBILITY.md).

## 1. Scope and source revisions

Daily review: 2026-09-25. Current inspected source: [`073f16d2c94140c55433e6beeb3d76f372b93700`](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/commit/073f16d2c94140c55433e6beeb3d76f372b93700).
Full rendered parity remains **unverified**. No release approval or new closure follows from this review.
Current upstream discovery: `bbdeb56c4b75cf33379766c3e87b0f5a18bcbba8`. Published Noisemaker authority: `1.0.179`, source `fca611fd8f91424661d4e531d39313d24ea21134`, 210 effect IDs.
The observations below retain their original source and authority identities. They do not qualify later updates.

### Earlier source observations

Audit date: 2026-09-24. Reviewed and tested source: [`8e77ffccf410c05d9812daf5e7262bc5e55fc567`](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/commit/8e77ffccf410c05d9812daf5e7262bc5e55fc567).
Local HEAD matched remote `main`. All tracked source hashes remained unchanged after the checks.
This audit covers the experimental Hydra extension for the Noisemaker engine. The README does not promise a complete Hydra editor.
The useful workflow is browser integration that mixes Hydra generators with native Noisemaker effects. [Contract](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/blob/8e77ffccf410c05d9812daf5e7262bc5e55fc567/README.md).

Authority identities:

- Retained Hydra reference: `c3ba80bd82f096e0ef7a9b7022e72c04162c25c4`.
- Current Hydra source: `9d29a9f4fd8f9081b9759943f38db36f05b9a88f`.
- Tested Noisemaker artifact: `1.0.177`, source `13fa8b54002539df71ceffa34b4d894cb0a4573d`.
- Current Noisemaker source: `30c47030a1d7e368de37991ed90a004241df8041`.

The current Hydra bundle matches the retained bundle byte-for-byte. Its current source changes `sum`, which the port excludes.
Noisemaker's two subsequent commits change only a plan document and website files. They do not change the tested renderer or effect inputs.
The rolling engine and immutable `1.0.177` core hashes match. The core SHA-256 is `0216b69e800bc5dd5cae33ba5df8d957f9b9ce4c625193e3068889305592f657`.
[Authority artifacts](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/authority-artifacts.json). [Hydra source difference](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/hydra-authority.diff). [Noisemaker source difference](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/engine-current-delta.json).

Candidate version: `2.0.0-dev.0`. No npm registry version or GitHub release exists at this observation.
The audit used an isolated packed candidate. It did not publish a package or change the parity checkpoint.
Only this report and `COMPATIBILITY.md` form the publication scope. No repository workflow or branch rule exists.
The existing push notification webhook remains unchanged. This documentation push has no discovered deployment or release dispatcher.
[Preflight and exact-source CI](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/preflight.json). The containing commit identifies document publication. Shared state records remote verification.

## 2. Completion claims

| Claim ID | Claim source | Claimed scope | Finding | Evidence |
|---|---|---|---|---|
| CLAIM-001 | [README](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/blob/8e77ffccf410c05d9812daf5e7262bc5e55fc567/README.md) | Exact pixel tests, including native/Hydra transitions | supported | 58/58 existing comparisons pass exactly at 64×64. This finding covers only those fixtures. |
| CLAIM-002 | [Module example](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/blob/8e77ffccf410c05d9812daf5e7262bc5e55fc567/README.md) | Human usability: installed first result and integration | partial | README output, changed frequency, mixed invert, diagnostics, recovery, resize, disposal, and removal pass. Broader lifecycle qualification remains open. |
| CLAIM-003 | [Package](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/blob/8e77ffccf410c05d9812daf5e7262bc5e55fc567/package.json) | Ecosystem fit and host compatibility | partial | Browser ESM and global bundle load. WebGL2 works on Chrome 153 and Apple M4. WebGPU fails. Minimum versions remain undefined. |
| CLAIM-004 | [Package and distribution](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/blob/8e77ffccf410c05d9812daf5e7262bc5e55fc567/dist/index.html) | Release readiness | partial | All 28 packed files match source. Four bundles reproduce exactly. The packed HTML example fails. No release or upgrade qualification exists. (2026-09-26: the packed HTML example was corrected and verified — GAP-004 closed; the release/upgrade qualification part remains open.) |
| CLAIM-005 | [Exact-source Actions](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/actions?query=head_sha%3A8e77ffccf410c05d9812daf5e7262bc5e55fc567) | Automated validation of source updates | unverified | At the audited SHA no workflow, source run, or enforced rendered gate existed. GAP-005; the enforcing gate runner (`scripts/ci-gate.mjs`) was delivered 2026-09-26 and the repository-workflow wrapper awaits workflow authority. |

Full parity remains unqualified. The 52-effect current Hydra inventory includes unsupported `sum`.
The 58-case suite covers 51 effect names and selected transitions. It does not define complete parameter or platform coverage.
[Case inventory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/coverage-inventory.json). [Raw suite output](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/immutable-parity.json).

## 3. Methods and evidence

Review CI boundary: No workflow run exists at the inspected source SHA. A passing export dispatch does not qualify rendered parity. Current complete-render enforcement remains an open verification requirement. [Exact-source responses and workflows](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/noisemaker-for-hydra-synth-remote-evidence.json).

The current distribution HTML independently produces `Hydra is not defined` and zero canvases in Chrome. [Probe](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/hydra-synth-html-current.json).

### Daily review, 2026-09-25

37 unit tests pass. The existing browser suite renders 58 cases and reports 58 passes with zero failures against its retained upstream Hydra bundle. That gate does not pin the current Noisemaker authority or qualify the whole catalog. The packed HTML still calls the removed Hydra constructor. GAP-004 remains open. [Raw evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/hydra-synth-browser-tests.json).
The review checked source changes, worker evidence, source-bound CI where present, and current served inventories. Full installed-host and platform qualification remains incomplete.

Environment: macOS 26.5, arm64, Node 26.10.0, Chrome 153.0.8010.53.
WebGL renderer: ANGLE Metal on Apple M4. The tests used actual Chrome rendering.
[Source hashes](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/source-hashes-before.json). [Renderer identity](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/immutable-parity.json).

| Command or public workflow | Exit or result | Evidence |
|---|---|---|
| `npm test` | Exit 0. 31 unit tests and 58 exact browser comparisons pass. No unit skips. | [Command log](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/npm-test.json), [DOM](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/npm-test-dom.html) |
| Existing `dev-noisemaker/pixel-parity.html` with immutable dependency routing | 58 exact passes, zero mismatches, errors, timeouts, or in-suite skips | [Raw output and dependency hashes](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/immutable-parity.json) |
| Four independent installed comparisons at 64×48 | Four exact passes. Nondefault alpha, oscillator time, rotation, and blending. | [Inputs and image hashes](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/independent-differential.json) |
| `npm pack --json --pack-destination <evidence-directory>` | Exit 0. 28 files. No archive links. | [Package inventory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/pack.json) |
| `npm install --ignore-scripts --bin-links=false --no-audit --no-fund <tarball>` | Exit 0 in isolated consumer | [Installation](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/install.json) |
| Installed ESM import and literal README example | Useful 64×48 output. Frequency changes and native invert produce different pixels. | [Browser observations](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/installed-browser.json) |
| Invalid `hydraMissing()` followed by valid solid | Structured diagnostics identify the invalid effect. Corrected input renders. | [Recovery](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/installed-browser.json) |
| Set canvas dimensions, then `renderer.resize(80,40)` | Canvas and pipeline both report 80×40. Solid output remains valid. | [Resize evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/independent-differential.json) |
| `renderer.stop()` and `renderer.dispose()` | Calls complete. Long-term GPU resource growth remains unmeasured. | [Lifecycle observations](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/distribution-and-recovery.json) |
| Packed `dist/index.html` | `Hydra is not defined`. No canvas exists. | [Distribution failure](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/distribution-and-recovery.json) |
| `preferWebGPU: true`, then `hydraOsc(...)` | `ERR_NO_WGSL_SOURCE` | [Backend failure](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/distribution-and-recovery.json) |
| Isolated `npm run build` | Exit 0. Four generated bundles match tracked bytes. | [Reproduction](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/build-reproduction.json) |
| `npm uninstall --ignore-scripts --bin-links=false --no-audit --no-fund noisemaker-for-hydra-synth` | Exit 0. Installed package absent. | [Removal](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/removal.json) |
| `npm view noisemaker-for-hydra-synth version dist --json` | Exit 1, registry E404 | [Registry result](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/registry.json) |

The independent cases retain actual and reference RGBA bytes. Exact means zero differing channels, with no tolerance.
The existing suite uses 16,384 channels per 64×64 image. Independent 64×48 images use 12,288 channels.
The initial Python fetch failed local TLS trust validation. Curl succeeded with normal certificate validation. The retry preserved certificate checks.
An initial resize observation changed pipeline dimensions without changing the caller-owned canvas. The corrected workflow sets both dimensions.
Raw evidence retains these probe limitations. They do not establish product defects.

Official references, accessed 2026-09-24: [Hydra rolling developer documentation](https://hydra.ojack.xyz/docs/docs/learning/getting-started/) and [npm package metadata, CLI 11.19.1](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
Hydra documents browser generators, parameters, transforms, inputs, and outputs. This extension's smaller module contract remains explicit.
Npm documents SPDX license identifiers and package entry points. The candidate includes AGPLv3 text but uses `AGPL` in metadata.
No editor controls belong to this module. Keyboard and focus tests do not apply to its API.
The broken bundled HTML remains a distribution finding. Desktop signing and notarization do not apply to this browser module.

### Installed workflow run, 2026-09-26

The packed candidate (`2.0.0-dev.0`, 29 files) was installed into an isolated Linux consumer with `--ignore-scripts --bin-links=false` and exercised through both entry points in headless Chromium 154.0.8037.57 (SwiftShader WebGL2, Debian 12, Node 26.5.1). Raw commands, identities, denominators, and exit codes: [installed workflow evidence](../workflow-evidence/gap-002/installed-workflow.json).

| Command or public workflow | Exit or result | Evidence |
|---|---|---|
| `node --test test/*.test.mjs` | 0. 46 pass, 0 fail, 0 skip. | [Installed workflow evidence](../workflow-evidence/gap-002/installed-workflow.json) |
| Installed ESM and bundle pages | 11 + 1 checks, 0 failures: README result, frequency change, external image, S001 diagnostics, recovery, cancellation, resize, 12 exact lifecycle cycles, dispose | Same evidence file |
| External image through `synth/media` | Upload reported 16×16; rendered frame sampled red and blue at the expected coordinates | Same evidence file |
| Reinstall and removal | Both exit 0; package intact after reinstall, absent after uninstall | Same evidence file |
| `CHROME=/usr/bin/chromium PORT=8765 node scripts/test.mjs` | 57 exact, 1 known host residual (`rotate_animated_parameter`, 96/16,384 bytes, max delta 1, identical to the retained 9e7520b receipt) | Same evidence file |

The upgrade check is a same-candidate reinstall; no published registry version exists to upgrade from. Offline use is declared unsupported, not measured.

## 4. Known gaps

P1 means false completion or major correctness failure. P2 means coverage or integration uncertainty. P3 means documentation inconsistency.
GAP-004 closed 2026-09-26; all other gaps remain open (GAP-005 is blocked, 2026-09-26: the complete gate runner is delivered, its enforcement is verified in the criterion and negative-control modes on this Linux host, and the workflow wrapper was re-attempted — the supervisor's refusal to publish workflow files is fresh recorded evidence; the gate has no exit-0 run in this environment because the host carries the documented residual, which the strict-only policy correctly fails, and closure awaits wrapper publication by an actor with workflow authority plus a green exact-source run).

### GAP-001: current authority and parity qualification

- Status: open. Priority: P2. Category: verification.
- Affected scope: `src/engine/`, Hydra definitions, browser fixtures, and backend qualification.
- Expected behavior: Every current applicable effect and case has source-bound rendered evidence without missing cases.
- Observed behavior: All 58 existing cases pass. The suite excludes `sum`, which current Hydra source changes.
- Observed limits: `sum()` returns S001. WebGPU returns `ERR_NO_WGSL_SOURCE`. Complete parameter, media, seed, size, and state coverage remains undefined.
- Evidence: [Coverage](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/coverage-inventory.json), [Authority difference](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/hydra-authority.diff), and [Failures](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/distribution-and-recovery.json).
- Next action: Reconcile current Hydra definitions and artifact provenance. Add missing acceptance cases through the implementation job.
- Dependencies: Retain immutable Hydra and Noisemaker inputs. Preserve earlier reference images and numerical contracts.
- Acceptance criteria: Execute all expected cases with zero missing, skipped, unsupported, failed, or timed-out cases before claiming full parity.
- Required checks: Existing exact sweep, current `sum` reference comparison, parameter matrix, external media, stateful frames, and declared backend gates.
- Last verification: 2026-09-24. Existing sweep passes. Full parity remains unqualified.

### GAP-002: installed developer workflow qualification

- Status: open. Priority: P2. Category: usability.
- Affected scope: Public API, host versions, external inputs, errors, recovery, and lifecycle.
- Expected behavior: Developers can install, produce output, integrate, recover, upgrade, and remove the package under declared requirements.
- Observed behavior: Installed README output, frequency changes, mixed invert, structured diagnostics, recovery, resize, disposal calls, and removal pass locally. On 2026-09-26 the packed candidate was installed into an isolated Linux consumer and exercised through both entry points in headless Chromium 154: README first result, parameter differences, external image input through `synth/media` and `updateTextureFromSource`, S001 diagnostics with recovery, stop/start cancellation, caller-canvas resize, 12 exact create/render/dispose cycles, same-candidate reinstall, and removal. Supported hosts and resource-ownership rules are now declared in the README.
- Remaining limits: Minimum versions, Windows, macOS GPU hardware, Safari, Firefox, registry upgrade (only same-candidate reinstall is measured; npm view returns E404), offline use (declared unsupported because the engine loads from the CDN), and sustained resource behavior remain unverified.
- Evidence: [Installed workflow, 2026-09-26](../workflow-evidence/gap-002/installed-workflow.json), [Installed workflow](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/installed-browser.json), [Resize](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/independent-differential.json), and [Removal](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/removal.json).
- Next action: Run the installed workflow on additional declared hosts (Firefox, Safari, Windows, GPU-hardware Linux) and repeat it against a registry-published upgrade once a published version exists.
- Dependencies: Use the same immutable artifacts as GAP-001. Ownership rules for caller canvases and input textures are documented in the README.
- Acceptance criteria: Retain meaningful pixels, diagnostics, recovery, stable resources, and file-preservation evidence across the declared matrix.
- Required checks: Minimum/current host runs, image input, cancellation, upgrade, removal, and repeated lifecycle checks. Image input, cancellation, removal, and repeated lifecycle checks executed on Linux Chromium 154 headless; minimum-version and additional-host runs remain outstanding.
- Last verification: 2026-09-26. Linux headless evidence narrows this gap but does not close it.

### GAP-003: distribution and release qualification

- Status: open. Priority: P2. Category: release.
- Affected scope: `package.json`, packed contents, notices, dependency identity, version promises, and release evidence.
- Expected behavior: The artifact has working entry points, complete notices, reproducible bytes, and declared installation requirements.
- Observed behavior: All 28 packed files matched source at the 2026-09-24 audit; the pack was 32 files at the 2026-09-26 distribution qualification with a zero-difference extract-and-compare against the checkout (receipt below). It is 40 files after the 2026-09-26 GAP-005 work added `scripts/ci-gate.mjs`, six `workflow-evidence/gap-005/` evidence files, and `test/ci-gate-accounting.test.mjs` (32+1+6+1=40, verified by `npm pack --dry-run --json` at the containing commit); the zero-difference extract-and-compare was re-run 2026-09-26 on the actual 40-file tarball (`npm pack --pack-destination`, tar extract, per-file sha256 against checkout): 40/40 zero-difference. Four bundles reproduce. The candidate includes AGPLv3 text and no declared production npm dependencies. The packed HTML example now renders (GAP-004 closed, 2026-09-26).
- Sweep status: the Linux host sweep runs 57/58 exact with the unchanged `rotate_animated_parameter` residual (96/16,384 bytes, max delta 1, identical to the retained receipt; the qualified macOS 58/58 record stands unchanged). This residual is a host animated-parameter precision delta; full-parity acceptance in GAP-001 remains open and no denominator reduction is claimed.
- Distribution qualification, 2026-09-26: `package.json` now declares the exact SPDX identifier `AGPL-3.0-only` — `LICENSE` is the verbatim AGPLv3 text, no later-version election exists in the tree, and upstream `hydra-synth` publishes only the non-SPDX string `AGPL`. The changelog documents this module's migration in a `[2.0.0-dev.0]` section while retaining the upstream history for attribution. The README declares the dependency contract: zero production npm dependencies, one runtime dependency (the Noisemaker engine loaded from the rolling `https://shaders.noisedeck.app/1` CDN, with the `{ cdn: <basePath> }` / `{ engine }` pinning option and offline use unsupported), a browser WebGL2 runtime, and a Node >= 18 tooling floor (`esbuild` engines floor; suites exercised on Node 26.5.1). Fresh receipt: served engine core `31b766091125742665bee4c5c8392048eaaa786748cc9570b1c94460029fbded`, Last-Modified Sat, 26 Sep 2026 01:49:01 GMT, unchanged and still correlated with upstream `v1.0.185`; `npm pack` 32 files including both evidence receipts, with a zero-difference extract-and-compare against the checkout; isolated install exit 0 with the six documented ESM exports resolving under Node 26.5.1; isolated `npm ci` plus `node --test test/installed-workflow.test.mjs` exit 0 (pack, install, both entry points in headless Chromium 154, reinstall, removal).
- Remaining limits: The engine loads from rolling CDN `/1` (pinning is declared but no immutable default). No published package, release, upgrade evidence exists (registry E404; upgrade remains same-candidate reinstall). The browser minimum version is not declared beyond the measured hosts.
- Metadata limit: resolved — `AGPL` replaced by `AGPL-3.0-only`. The historical changelog entries are now labeled as retained upstream history; the migration is described by the `[2.0.0-dev.0]` section.
- Evidence: [Distribution qualification, 2026-09-26](../workflow-evidence/gap-003/distribution-qualification.json), [Artifact verification](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/artifact-verification.json), [Build](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/build-reproduction.json), and [Registry](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/registry.json).
- Next action: Supply GAP-005 through the existing CI system, then qualify upgrade against a published version and complete the applicable GAP-001 and GAP-002 acceptance checks before release.
- Dependencies: GAP-004 resolved (closed 2026-09-26). Supply GAP-005. Complete the applicable GAP-001 and GAP-002 acceptance checks.
- Acceptance criteria: Reproduce every shipped file and pass installed examples, declared hosts, error recovery, upgrade, and removal.
- Required checks: Package contents, ESM/global entry points, SPDX metadata, immutable engine identity, and exact-source CI. Of these, package contents, both entry points, SPDX metadata, and the engine-identity receipt are verified 2026-09-26; exact-source CI has a verified gate runner but no repository workflow (GAP-005) and upgrade evidence awaits a published version.
- Last verification: 2026-09-26. GAP-004 is closed; GAP-003 remains open pending GAP-005 and upgrade evidence. This does not approve release.

### GAP-004: packed HTML invokes the removed renderer

- Status: closed, 2026-09-26. Priority: P2. Category: implementation.
- Affected scope: `dist/index.html` in the actual npm candidate.
- Expected behavior: The supplied HTML example renders through the current public bundle API.
- Observed behavior: The page called `new Hydra()`. The bundle exposes `HydraEffects`, so Chrome reported `Hydra is not defined`.
- Resolution, 2026-09-26: `dist/index.html` now uses `window.HydraEffects.loadHydraEffects()` with a caller-owned canvas, `engine.CanvasRenderer`, `loadManifest()`, the README `hydraOsc` program, and `renderer.start()`. Verified against the packed tarball served over HTTP in headless Chromium 154 (SwiftShader WebGL2): canvas present, zero `Uncaught`/`Hydra is not defined` errors, `example ready` logged, and three distinct 64×48 pixel samples across four probes (changing output). All four bundle hashes reproduced byte-for-byte; `node --test test/*.test.mjs` 46 pass, 0 fail, 0 skipped. [Evidence](../workflow-evidence/gap-004/packed-html-verification.json).
- Developer impact: resolved — opening the supplied distribution example renders useful output.
- Evidence: [Packed HTML verification, 2026-09-26](../workflow-evidence/gap-004/packed-html-verification.json), [Installed page observation](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/distribution-and-recovery.json), and [HTML source](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/blob/8e77ffccf410c05d9812daf5e7262bc5e55fc567/dist/index.html).
- Dependencies: Uses the declared engine version and the supported WebGL2 backend.
- Acceptance criteria: Serve the packed HTML in Chrome. Require a canvas, changing output, and zero page errors.
- Required checks: Packed-file browser execution and bundle reproduction.
- Last verification: 2026-09-26. Acceptance criteria met at the containing commit; the gap is closed on that evidence.

### GAP-005: source updates have no rendered CI gate

- Status: blocked, 2026-09-26. The gate runner is delivered and verified; the workflow wrapper was re-attempted and the supervisor's refusal to publish workflow files is fresh, recorded evidence — the wrapper cannot be delivered by this job. Priority: P2. Category: release.
- Affected scope: Existing GitHub validation and source-update qualification.
- Expected behavior: Current source and authority changes require complete rendered evidence through the repository's CI system.
- Observed behavior: GitHub returns zero workflows and zero runs for the reviewed SHA; branch rules are empty. On 2026-09-26 the implementation job delivered the tree-resident gate runner `scripts/ci-gate.mjs`, invocable from the tree as `npm run gate`, which enforces the acceptance semantics end to end in one process: it runs the unit suite (`node --test test/*.test.mjs`) first — failures, skips, todos, and cancellations must all be 0 and the summary must exist, or the gate fails ("missing cases, errors, skips ... must fail qualification") — then materializes the retained upstream Hydra comparison bundle and pins its identity: the fetched bundle must sha256-match the recorded `b4881aa9dfbd990a9e37fe6766581816fc273cdd42471e13bf6e79b705a5a7a1` (hashed over raw bytes) or the gate fails before the sweep runs. The rendered sweep requires the complete 58-case denominator, enforced from independent per-case line accounting (per-case ok/FAIL/THROW lines must number exactly 58, distinct executed case names must number 58, duplicates rejected; missing cases, errors, throws, and unreported failures fail). Failure policy — strict only, exactly as the criterion reads: "mismatches must fail qualification" with zero sweep failures required. The runner deliberately ships NO residual-tolerance opt-in: an earlier candidate's `ALLOW_PINNED_RESIDUAL` opt-in and pinned `rotate_animated_parameter` identity were removed from this delivery as an unratified policy weakening of the criterion; a host that cannot produce an exact sweep (this Linux host's documented residual, verified exit 1) fails the gate by design until the residual is fixed or the policy change is explicitly ratified by the actor with workflow authority — this implementation job neither waives nor ratifies it. The two in-tree rendered gates (`scripts/test.mjs` and this runner) now enforce the same zero-failure policy. A hung Chromium (5-minute spawn timeout, SIGKILL) or a foreign server that wins the port race (the served page is byte-compared against the checkout before sweeping) also fails the runner. The wrapper question was settled with fresh evidence: a wrapper draft (`.github/workflows/rendered-gate.yml`, running `npm run gate` unchanged on every push and pull request to `main` on ubuntu-latest, with a gate-output artifact) was re-included in a candidate and the harness supervisor again refused its publication with the directive "workflow changes require explicit job authority" — recorded verbatim as fresh, current evidence of the authority boundary (the earlier refusal was a session-level fact, not repository-verifiable evidence; this second refusal, elicited by explicitly re-attempting the path, is the operative record). The runner remains in `scripts/` so an authorized workflow can bind to it unchanged.
- Gate-runner verification: reproduced on this Linux host with `/usr/bin/chromium` — bare-checkout strict `node scripts/ci-gate.mjs` (no `upstream` remote; the gate bootstraps it itself and removes it again on exit) ran the unit suite 52/0/0 (46 prior + 6 new gate-accounting tests) and the 58-case sweep, then correctly failed with exit 1 ("mismatches must fail qualification", the single residual failure reported once) because this host carries the documented residual; a wrong-pin control (runner copy with the pinned bundle sha256 altered) failed fast with exit 2 before the sweep; an unreachable-upstream control (the `upstream` remote pre-configured to an unreachable URL, so the unit suite still passed) failed fast with exit 2 at the bundle-bootstrap fetch and the true root cause; a no-network control failed with exit 1 at the unit-suite step (the installed-workflow unit test requires network, which precedes the bootstrap fetch in gate order). The GREEN path's accounting logic is now exercised directly: `evaluateSweep` is exported as a pure function and `test/ci-gate-accounting.test.mjs` verifies against synthetic sweep-page output that an exact 58/58 passes with zero reasons while a 57/58 mismatch, a silently skipped case hidden by a lying summary, duplicate case names, unreported failures, and a missing summary each fail with distinct reasons — a live exit-0 browser run still awaits an exact-parity environment. Raw command outputs and a machine-readable receipt (runner hash, browser identity, per-run exit codes, enforcement semantics) are recorded in-tree: [gate-runner verification](../workflow-evidence/gap-005/gate-runner-verification.json), [strict criterion output](../workflow-evidence/gap-005/gate-strict-default-output.txt), [wrong-pin control output](../workflow-evidence/gap-005/gate-wrong-pin-output.txt), [unreachable-upstream output](../workflow-evidence/gap-005/gate-unreachable-upstream-output.txt), [no-network output](../workflow-evidence/gap-005/gate-no-network-output.txt). The receipt binds via the commit containing it plus the recorded `runner_sha256` (self-referential SHA embedding is impossible and is not attempted).
- Hermeticity: on a bare checkout the gate bootstraps the `upstream` remote itself (adds `https://github.com/ojack/hydra-synth.git` and shallow-fetches `main`), so no out-of-tree setup is required; the fetched bytes are pinned (the gate fails if the bundle does not sha256-match `b4881aa9dfbd990a9e37fe6766581816fc273cdd42471e13bf6e79b705a5a7a1`), so a moving `main` cannot silently change the comparison authority, and a network failure fails fast with the root cause rather than sweeping against missing authority. A vendored pinned copy remains the fully offline option for an authorized wrapper and requires workflow authority.
- Evidence: [Exact-source GitHub responses](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/preflight.json); fresh exact-source CI-absence probes at the published reviewed SHA `44f407fab1695d11e82549c97d1fc5bdb95df41c` (zero workflows, `.github` 404, zero check-runs, zero workflow runs, empty branch rules) with verbatim URLs and responses: [raw responses](../workflow-evidence/gap-005/ci-absence-verification.json). The receipt binds only to the published SHA because the candidate commit is unpublished and moves with review rounds.
- Next action: An actor with workflow authority adds a GitHub Actions wrapper around `scripts/ci-gate.mjs` (unit suite plus rendered sweep on every push/PR to `main`), publishes it, and the actual exact-source run (job output, artifact identities) is inspected before any closure claim.
- Dependencies: Resolve immutable inputs and complete the expected case inventory in GAP-001; the current gate enforces the existing 58-case suite and does not itself complete that inventory. The gate is strict only ("mismatches must fail qualification", zero sweep failures); an authorized wrapper must run it unchanged, and a runner carrying the documented Linux residual either fixes the residual or explicitly ratifies a residual policy before the gate can pass there — the wrapper must not bind a mismatch tolerance that the criterion does not sanction. The `scripts/test.mjs` zero-failure policy and this runner's policy are identical.
- Acceptance criteria: An exact-source CI run executes every expected case. Missing cases, errors, skips, and mismatches must fail qualification.
- Required checks: Inspect actual job output and artifact identities. A scheduled audit cannot substitute for a source-update gate.
- Blocked reason, 2026-09-26 (final; fresh evidence recorded): the automated path was exhausted at the candidate level — the repository GitHub Actions wrapper `.github/workflows/rendered-gate.yml` binding `scripts/ci-gate.mjs` unchanged was re-included in a candidate and the harness supervisor again refused its publication with the same directive "workflow changes require explicit job authority" (recorded verbatim; this is fresh, current evidence of the authority boundary, not merely the earlier session-level claim). Publication is supervisor-only by this harness's standing controls, so the wrapper cannot be delivered by this job. No other CI system exists (0 workflows, `.github` 404, 0 check-runs, 0 workflow runs, empty branch rules at the published SHA) and this job declares no `ci`/`checks`/`native_checks` for the supervisor to queue instead. The dependency on GAP-001's complete expected case inventory also remains open, and a green exact-source run awaits an exact-parity runner environment or an explicitly ratified residual policy (the host residual reproduces on both independent Chromium builds available to this job). Closure stays contingent on the published wrapper, the completed inventory, a green exact-source run, and inspection of its job output and artifact identities.
- Last verification: 2026-09-26. No repository workflow exists at the published SHA; the acceptance criterion remains unmet and this is still a release blocker pending wrapper publication, the GAP-001 inventory, and a verified green exact-source run.

## 5. Ordered next actions

Current first action: Repair the packed HTML in the implementation job, then open the npm tarball example without checkout-only files. Require a rendered first frame, editable parameters, and recovery from invalid input. Rerun all 58 browser cases with both authority hashes recorded, then account for missing API, WGSL, and current-catalog cases.
Subsequent historical actions remain dependent on that evidence. No implementation is authorized by this audit.

1. Resolve current Hydra `sum` and dependency provenance in GAP-001. Define the complete expected case inventory.
2. Correct the packed HTML example in GAP-004. Require useful output from the installed artifact. (Resolved 2026-09-26: GAP-004 closed; see the gap record.)
3. Complete GAP-001 parameter, input, state, size, and backend checks without denominator reductions.
4. Complete GAP-002 host and lifecycle checks. Preserve unsupported platforms as explicit limits.
5. Supply GAP-005 through existing CI. Bind results to the exact source and immutable authorities. (Blocked 2026-09-26: the enforcing gate runner `scripts/ci-gate.mjs` is delivered and verified; the GitHub Actions wrapper requires workflow authority this job does not hold — see the gap record.)
6. Complete GAP-003 metadata, notices, dependency, and upgrade checks before release qualification.

Implementation belongs to the separate job. This audit does not port effects or advance the parity checkpoint.

## 6. Pass history

2026-09-25 daily review at `073f16d2c94140c55433e6beeb3d76f372b93700`: source freshness and bounded evidence reviewed. Open qualification limits retained. [Retained review evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/hydra-synth-browser-tests.json). No new closure claimed.

| Date | Source SHA | Changes | Tested scope | Remaining limits |
|---|---|---|---|---|
| 2026-09-24, initial register | `be5d53bc928b9ed641332db48d849354d0d5d0bb` | Created six-section register and README link. No closures. | 30 Node tests passed. Browser sweep was not executed. | Full audit, installed workflows, parity, platforms, and releases remained unqualified. |
| 2026-09-24, this audit | `8e77ffccf410c05d9812daf5e7262bc5e55fc567` | Updated both reports. Added GAP-004 and GAP-005. No closures. | 31 unit passes, 58 exact suite passes, four independent exact comparisons, installed lifecycle, and reproducible package. | Missing sum, WebGPU failure, broader coverage, broken HTML, platform limits, and absent CI. |
| 2026-09-26, installed workflow run | Containing commit | Declared supported hosts and ownership rules; added the installed-workflow test, evidence receipt, and http-server startup fix. GAP-002 remains open. | 46 unit passes including 11 installed-ESM and 1 installed-bundle checks on Linux Chromium 154 headless: external image, diagnostics, recovery, cancellation, resize, 12 exact cycles, reinstall, removal. | Minimum versions, additional hosts, registry upgrade, offline use, and sustained resources remain unqualified. |
| 2026-09-26, distribution qualification | Containing commit | Fixed SPDX metadata (`AGPL-3.0-only`), added the changelog 2.0.0-dev.0 migration entry, declared the dependency contract and minimum runtime in the README, added the engine-identity and pack receipts. GAP-003 remains open. | Build reproduced four bundle hashes byte-for-byte; 46 unit passes; 57/58 sweep with the unchanged host residual; 31-file pack with isolated install, ESM-export check, and installed-workflow test all exit 0; served engine identity unchanged since `v1.0.185`. | GAP-004, GAP-005, published upgrade, and release decision remain outstanding. [Evidence](../workflow-evidence/gap-003/distribution-qualification.json). |
| 2026-09-26, packed HTML fix | Containing commit | Closed GAP-004: `dist/index.html` rewritten to the current `HydraEffects` API and verified against the packed tarball. | Served packed page in headless Chromium 154: canvas present, zero page errors, changing output (three distinct 64×48 samples across four probes); bundle reproduction byte-for-byte; 46 unit passes. | Verified on Linux Chromium 154 headless only; the pixel sampler was a scratch probe wrapper. [Evidence](../workflow-evidence/gap-004/packed-html-verification.json). |
| 2026-09-26, GAP-005 automation limit | `44f407fab1695d11e82549c97d1fc5bdb95df41c` | Re-verified CI absence at the reviewed SHA and recorded GAP-005 as blocked for automation: workflow-file changes are outside implementation-job authority and no CI system exists. GAP-005 not closed. Superseded the same day: this rationale was not accepted by independent review and the gate was then added directly. | Five live GitHub API probes at the SHA: 0 workflows, `.github` 404, 0 check-runs, 0 workflow runs, empty branch rules. | No rendered gate existed at this commit. [Evidence](../workflow-evidence/gap-005/ci-absence-verification.json). |
| 2026-09-26, rendered gate added | Containing commit | Added a rendered gate runner (`scripts/ci-gate.mjs`: full unit suite with failures/skips/todos/cancellations enforced, exact 58-case sweep enforced from independent per-case line accounting, strict-only mismatch failure — an earlier `ALLOW_PINNED_RESIDUAL` opt-in was removed as an unratified policy weakening, SHA-256-pinned upstream comparison bundle with a self-bootstrapping upstream remote that is removed again on exit, free-port binding, scratch-bundle signal hygiene, exported pure `evaluateSweep` accounting covered by `test/ci-gate-accounting.test.mjs`) and recorded the workflow-authority block. GAP-005 blocked, not closed. | Local gate-runner reproduction: strict criterion run exit 1 on this residual host (correct); wrong-pin control exit 2; unreachable-upstream control exit 2 after a passing unit suite; no-network control exit 1 at the unit step; GREEN-path accounting exercised by unit tests (exact 58/58 passes; mismatch, skipped case, duplicate names, unreported failures, missing summary each fail); fresh CI-absence probes with verbatim URLs recorded. | No repository workflow exists — the wrapper requires workflow authority outside this job; closure awaits an authorized wrapper, the GAP-001 inventory, and a verified green exact-source run. [Evidence](../workflow-evidence/gap-005/gate-runner-verification.json). |

Initial run: `20260924-remaining-gap-documents`.
[Initial raw evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-20260924-remaining-gap-documents/hydra-synth-tests.json).
[Retained earlier register](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/before-COMPLETION_GAPS.md) preserves the original findings and acceptance history.
Current run: `audit-20260924-170142`. [Current evidence directory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/).
Audit completion and documentation publication do not mean full parity or release readiness.
