# noisemaker-for-hydra-synth: completion gaps

Current measured support: [compatibility report](COMPATIBILITY.md).

## 1. Scope and source revisions

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
| CLAIM-004 | [Package and distribution](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/blob/8e77ffccf410c05d9812daf5e7262bc5e55fc567/dist/index.html) | Release readiness | partial | All 28 packed files match source. Four bundles reproduce exactly. The packed HTML example fails. No release or upgrade qualification exists. |
| CLAIM-005 | [Exact-source Actions](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/actions?query=head_sha%3A8e77ffccf410c05d9812daf5e7262bc5e55fc567) | Automated validation of source updates | unverified | No workflow, source run, or enforced rendered gate exists. GAP-005. |

Full parity remains unqualified. The 52-effect current Hydra inventory includes unsupported `sum`.
The 58-case suite covers 51 effect names and selected transitions. It does not define complete parameter or platform coverage.
[Case inventory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/coverage-inventory.json). [Raw suite output](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/immutable-parity.json).

## 3. Methods and evidence

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

## 4. Known gaps

P1 means false completion or major correctness failure. P2 means coverage or integration uncertainty. P3 means documentation inconsistency.
No gap closed during this audit.

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
- Observed behavior: Installed README output, frequency changes, mixed invert, structured diagnostics, recovery, resize, disposal calls, and removal pass locally.
- Remaining limits: Minimum versions, Windows, Linux, Safari, Firefox, real media, upgrades, cancellation, offline use, and sustained resource behavior remain unverified.
- Evidence: [Installed workflow](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/installed-browser.json), [Resize](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/independent-differential.json), and [Removal](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/removal.json).
- Next action: Declare supported hosts. Exercise one external-image workflow and repeated create/render/dispose cycles through the installed API.
- Dependencies: Use the same immutable artifacts as GAP-001. Identify ownership rules for caller canvases and input textures.
- Acceptance criteria: Retain meaningful pixels, diagnostics, recovery, stable resources, and file-preservation evidence across the declared matrix.
- Required checks: Minimum/current host runs, image input, cancellation, upgrade, removal, and repeated lifecycle checks.
- Last verification: 2026-09-24. Local browser evidence narrows this gap but does not close it.

### GAP-003: distribution and release qualification

- Status: open. Priority: P2. Category: release.
- Affected scope: `package.json`, packed contents, notices, dependency identity, version promises, and release evidence.
- Expected behavior: The artifact has working entry points, complete notices, reproducible bytes, and declared installation requirements.
- Observed behavior: All 28 packed files match source. Four bundles reproduce. The candidate includes AGPLv3 text and no declared production npm dependencies.
- Remaining limits: The engine loads from rolling CDN `/1`. No published package, release, upgrade evidence, or minimum runtime declaration exists.
- Metadata limit: `AGPL` does not identify an exact SPDX license. Historical changelog entries do not describe the current module migration.
- Evidence: [Artifact verification](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/artifact-verification.json), [Build](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/build-reproduction.json), and [Registry](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/registry.json).
- Next action: Define the candidate's support and dependency contract. Qualify notices, metadata, and upgrades before release.
- Dependencies: Resolve GAP-004 and supply GAP-005. Complete the applicable GAP-001 and GAP-002 acceptance checks.
- Acceptance criteria: Reproduce every shipped file and pass installed examples, declared hosts, error recovery, upgrade, and removal.
- Required checks: Package contents, ESM/global entry points, SPDX metadata, immutable engine identity, and exact-source CI.
- Last verification: 2026-09-24. This audit does not approve release.

### GAP-004: packed HTML invokes the removed renderer

- Status: open. Priority: P2. Category: implementation.
- Affected scope: `dist/index.html` in the actual npm candidate.
- Expected behavior: The supplied HTML example renders through the current public bundle API.
- Observed behavior: The page calls `new Hydra()`. The bundle exposes `HydraEffects`, so Chrome reports `Hydra is not defined`.
- Developer impact: Opening the supplied distribution example produces no canvas or useful output.
- Evidence: [Installed page observation](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/distribution-and-recovery.json) and [HTML source](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/blob/8e77ffccf410c05d9812daf5e7262bc5e55fc567/dist/index.html).
- Next action: Correct the existing example through the implementation job. Use the documented `HydraEffects` API.
- Dependencies: Use the declared engine version and supported WebGL backend.
- Acceptance criteria: Serve the packed HTML in Chrome. Require a canvas, changing output, and zero page errors.
- Required checks: Packed-file browser execution and bundle reproduction.
- Last verification: 2026-09-24. Failure reproduced in the isolated installed package.

### GAP-005: source updates have no rendered CI gate

- Status: open. Priority: P2. Category: release.
- Affected scope: Existing GitHub validation and source-update qualification.
- Expected behavior: Current source and authority changes require complete rendered evidence through the repository's CI system.
- Observed behavior: GitHub returns zero workflows and zero runs for the reviewed SHA. Branch rules are empty.
- Evidence: [Exact-source GitHub responses](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/preflight.json).
- Next action: Have the implementation job add and check a rendered gate through the existing CI system.
- Dependencies: Resolve immutable inputs and complete the expected case inventory in GAP-001.
- Acceptance criteria: An exact-source CI run executes every expected case. Missing cases, errors, skips, and mismatches must fail qualification.
- Required checks: Inspect actual job output and artifact identities. A scheduled audit cannot substitute for a source-update gate.
- Last verification: 2026-09-24. No gate exists. This remains a release blocker.

## 5. Ordered next actions

1. Resolve current Hydra `sum` and dependency provenance in GAP-001. Define the complete expected case inventory.
2. Correct the packed HTML example in GAP-004. Require useful output from the installed artifact.
3. Complete GAP-001 parameter, input, state, size, and backend checks without denominator reductions.
4. Complete GAP-002 host and lifecycle checks. Preserve unsupported platforms as explicit limits.
5. Supply GAP-005 through existing CI. Bind results to the exact source and immutable authorities.
6. Complete GAP-003 metadata, notices, dependency, and upgrade checks before release qualification.

Implementation belongs to the separate job. This audit does not port effects or advance the parity checkpoint.

## 6. Pass history

| Date | Source SHA | Changes | Tested scope | Remaining limits |
|---|---|---|---|---|
| 2026-09-24, initial register | `be5d53bc928b9ed641332db48d849354d0d5d0bb` | Created six-section register and README link. No closures. | 30 Node tests passed. Browser sweep was not executed. | Full audit, installed workflows, parity, platforms, and releases remained unqualified. |
| 2026-09-24, this audit | `8e77ffccf410c05d9812daf5e7262bc5e55fc567` | Updated both reports. Added GAP-004 and GAP-005. No closures. | 31 unit passes, 58 exact suite passes, four independent exact comparisons, installed lifecycle, and reproducible package. | Missing sum, WebGPU failure, broader coverage, broken HTML, platform limits, and absent CI. |

Initial run: `20260924-remaining-gap-documents`.
[Initial raw evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-20260924-remaining-gap-documents/hydra-synth-tests.json).
[Retained earlier register](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/before-COMPLETION_GAPS.md) preserves the original findings and acceptance history.
Current run: `audit-20260924-170142`. [Current evidence directory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/).
Audit completion and documentation publication do not mean full parity or release readiness.
