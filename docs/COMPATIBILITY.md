# noisemaker-for-hydra-synth: compatibility report

## 1. Source and authority revisions

Daily review: 2026-09-25. Current inspected source: [`073f16d2c94140c55433e6beeb3d76f372b93700`](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/commit/073f16d2c94140c55433e6beeb3d76f372b93700).
Full rendered parity remains **unverified**. No release approval or new closure follows from this review.
Current upstream discovery: `bbdeb56c4b75cf33379766c3e87b0f5a18bcbba8`. Published Noisemaker authority: `1.0.179`, source `fca611fd8f91424661d4e531d39313d24ea21134`, 210 effect IDs.
The observations below retain their original source and authority identities. They do not qualify later updates.

### Upstream range audit, 2026-09-25

Delivered range: noisefactorllc/noisemaker `4891b9953f9fd8a61cf9ae0dda2fe747a9be82df..9d3474dfdc6cb737ebb7b2f3598b16d940af1544`. The trigger carried a force-push marker, so the range was audited rather than assumed. Recorded facts, each reproducible with the stated command against that upstream repository:

- `git merge-base --is-ancestor 4891b9953f9f 9d3474dfdc6c` exits 0: the range start is an ancestor of the range end, so the range is contiguous despite the force-push flag.
- `git log --oneline 4891b9953f9f..9d3474dfdc6c` lists 19 commits. In order: `9d3474df`, `ba87ffae`, `0bd09d00`, `0610e077`, `286ccf68`, `cfccdf96`, `5f4b7c43`, `c85db3f0`, `5a58a325`, `240740dd`, `66b2c721`, `3886ecfa`, `60b90af3`, `bbdeb56c`, `8a21c9ca`, `fca611fd`, `9fa1a221`, `3923222b`, `c8c11b3d`.
- `git merge-base --is-ancestor 240740dd 0bd09d00c41c` exits 0, and `git log --oneline 4891b9953f9f..0bd09d00c41c -- shaders/` lists exactly `240740dd`, `66b2c721`, `fca611fd`, `9fa1a221`. The synced port candidate `acf6443e90ebf78f1189e22ad035e54992995061` covers through `240740dd`, so the already-synced part spans `4891b995..240740dd` and the audited remainder is `240740dd..9d3474df`.
- `git diff --stat 4891b9953f9f 9d3474dfdc6c` over the whole tree reports 19 files, +3,775/-248: `LEDGER.md` (95), `docs/plans/active-framework-gap.md` (384), `docs/shaders/language.rst` (18), `index.html` (72), `llms-full.txt` (176), `package.json` (4), `scripts/run-js-tests.js` (3), `shaders/src/lang/diagnostics.js` (3), `shaders/src/lang/index.js` (4), `shaders/src/lang/lexer.js` (93), `shaders/src/lang/parser.js` (117), `shaders/src/lang/validator.js` (14), `shaders/src/runtime/effect-validator.js` (1,115), `shaders/tests/fixtures/subchain-argument-baseline.json` (883), `shaders/tests/test_diagnostic_locations.js` (194), `shaders/tests/test_effect_definition_validation.js` (457), `shaders/tests/test_subchain_argument_differential.js` (81), `shaders/tests/test_subchain_arguments.js` (252), `site.css` (58).

Effect-catalog parity consequence, verifiable from the file list above: the range changes no file under `shaders/effects/`, no effect definition file, and no parameter contract. `shaders/src/lang` and `shaders/src/runtime/effect-validator.js` are Noisemaker engine internals that this port consumes through the CDN engine bundle rather than vendoring; the port's own sources are unaffected. The port's catalog source is Hydra's `src/glsl/glsl-functions.js` (Hydra upstream `9d29a9f4fd8f9081b9759943f38db36f05b9a88f`), which this range does not touch. Direct checks on the port tree at candidate `acf6443e..1ccba79`: `src/glsl/glsl-functions.js` defines 52 effects including `sum`; `src/engine/hydraGlsl.js` line 2 excludes only `sum` from registration, so 51 effects register. SHA-256 identity receipts for the unchanged port sources at this candidate: `src/glsl/glsl-functions.js` `d9eb06b3bad3f692fd3227ed0281428aa52104151b45efedea8c3c2ac02f37c7`; `src/engine/portHydraEffects.js` `490346be10aea64f4e07630ab8a7f4f909fe18d8f7609aefb6e2dc3fd92b332a`; `dist/hydra-synth.js` `974ec20bdd9a5bf6749a30ed4139c8226bf22b6080a6d9c1145b2f3e6aedbc60`; `dist/hydra-synth.esm.js` `5a4c261c303b4512135ad8bf3c9f94208a972272e1d1aea9a573f0d7177c6f41`; `dist/hydra-synth.esm.min.js` `b8d110c54b99e8239c61d2933ff5b059c738f66afb29fe789458c93d94816a82`; `dist/hydra-synth.min.js` `39f4e3d1f9a3ad3a43c4f088bd59a2f1105359c05b9ee70f16b539ef7259e2f9`. An isolated `npm run build` on this host reproduced all four bundle hashes byte-for-byte, confirming the shipped dist matches source.

Test receipts on this Linux audit host (Node 26.5.1, Chromium headless WebGL2/SwiftShader): `node --test test/*.test.mjs` — 40 pass, 0 fail, 0 skipped. `node scripts/test.mjs` with `CHROME=/usr/bin/chromium` — 57 exact comparisons and one failure: `rotate_animated_parameter`, 96/16,384 bytes differ, max delta 1. The same sweep with the animated subchain replaced by its resolved literal renders 58/58 exact, which isolates the residual delta to animated-parameter evaluation precision on this host's GL implementation, not to effect-catalog or translation differences; the port source is identical to the published `acf6443e` tree, so sweep behavior is unchanged by this candidate. The qualified macOS sweep record (58/58 exact on Apple M4 ANGLE) stands unchanged.

### Earlier source observations

Observation: 2026-09-24. Current and tested port source: [`8e77ffccf410c05d9812daf5e7262bc5e55fc567`](https://github.com/noisefactorllc/noisemaker-for-hydra-synth/commit/8e77ffccf410c05d9812daf5e7262bc5e55fc567).
Candidate version: `2.0.0-dev.0`. Local source matched remote `main` and remained unchanged during tests.
Full parity: **unverified**. Release readiness: **blocked**. This report records a completed audit, not product qualification.

| Input | Revision | Freshness and measured scope |
|---|---|---|
| Retained Hydra reference | `c3ba80bd82f096e0ef7a9b7022e72c04162c25c4` | Existing gate reference. |
| Current Hydra source | `9d29a9f4fd8f9081b9759943f38db36f05b9a88f` | Current bundle equals retained bundle. Current source changes excluded sum. Full source parity remains unverified. |
| Tested Noisemaker engine | `1.0.177`, `13fa8b54002539df71ceffa34b4d894cb0a4573d` | Immutable core and fetched effects identify the measured runtime. |
| Current Noisemaker source | `30c47030a1d7e368de37991ed90a004241df8041` | Two subsequent commits change only website files and a plan document. Tested runtime inputs remain unchanged. |
| Published port artifact | None found | npm E404 and empty GitHub releases. Installed candidate is not a published release. |

The engine core SHA-256 is `0216b69e800bc5dd5cae33ba5df8d957f9b9ce4c625193e3068889305592f657`.
The current Hydra bundle SHA-256 is `b4881aa9dfbd990a9e37fe6766581816fc273cdd42471e13bf6e79b705a5a7a1`.
Rolling and immutable engine core bytes match. The immutable run records all six requested dependency responses and their hashes.
[Artifact identity](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/authority-artifacts.json). [Engine source difference](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/engine-current-delta.json). [Hydra source difference](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/hydra-authority.diff).

The native Noisemaker manifest contains 210 IDs. These do not define this extension's Hydra denominator.
Current Hydra definitions contain 52 effects. The port registers 51 and excludes `sum`.
[Current inventory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/coverage-inventory.json). Every later runtime, packaging, or authority change requires fresh evidence.

## 2. Host and distribution matrix

Current tests and qualification limits are in [section 3](#3-parity-coverage).
The matrix below retains the earlier measured scope. A historical verified row is not a current-source or full-platform certification.

| Dimension | Status | Measured scope or remaining limit |
|---|---|---|
| macOS 26.5, Chrome 153.0.8010.53, Apple M4, WebGL2 | verified | 58 exact 64×64 comparisons and four independent 64×48 comparisons. |
| WebGPU, hydraOsc | failed | `ERR_NO_WGSL_SOURCE`. This report claims no successful WebGPU render. |
| Current Hydra sum | failed | S001 unknown effect. One current effect lacks an executable parity fixture. |
| Node 26.10.0 unit contracts | verified | 31 pass, zero fail, zero skip. This is separate from rendered qualification. |
| Packed candidate installation | verified | Local tarball installs into an isolated consumer. All 28 packed files match source. |
| ESM and browser global entry points | verified | ESM exposes six documented exports. Global bundle exposes HydraEffects. |
| README first useful result | verified | hydraOsc renders at 64×48. Frequency changes and native invert produce different output. |
| Invalid input and recovery | verified | hydraMissing produces structured diagnostics. Corrected solid renders. |
| Resize | verified | Caller sets canvas dimensions and calls resize. Canvas and pipeline reach 80×40 with valid output. |
| Stop, disposal, and removal | verified | Public calls complete. npm removal succeeds. Sustained GPU resource behavior remains unmeasured. |
| Packed dist/index.html | failed | Removed Hydra constructor causes ReferenceError. The page creates no canvas. |
| Bundle reproduction | verified | Four JavaScript bundles match tracked bytes after an isolated build. |
| External media, seed coverage, long stateful chains | unverified | Existing surfaces and short feedback checks do not qualify these broader workflows. |
| Minimum browsers, Safari, Firefox, Windows, Linux | unverified | No measured version or platform matrix. |
| Upgrades, offline use, cancellation, sustained lifecycle | unverified | No complete installed qualification. |
| Package metadata and notices | unverified | AGPLv3 text exists. AGPL metadata lacks an exact SPDX identifier. Rolling CDN dependency needs a contract. |
| Source-update CI | blocked | Zero workflows and exact-source runs. No rendered gate exists. |
| Release readiness | blocked | Complete parity, artifact examples, host coverage, and CI remain unresolved. |

This module provides no editor controls. Keyboard, focus, and control-label checks do not apply to its public API.
The packed HTML example remains subject to runtime checks. Browser modules do not require desktop signing or notarization.
[Installed observations](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/installed-browser.json). [Failures and lifecycle calls](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/distribution-and-recovery.json). [Package verification](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/artifact-verification.json).

## 3. Parity coverage

### Daily review, 2026-09-25

37 unit tests pass. The existing browser suite renders 58 cases and reports 58 passes with zero failures against its retained upstream Hydra bundle. That gate does not pin the current Noisemaker authority or qualify the whole catalog. The packed HTML still calls the removed Hydra constructor. GAP-004 remains open. [Raw evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/hydra-synth-browser-tests.json).

The current full case denominator remains incomplete. Missing parameters, hosts, external inputs, and stateful sequences remain qualification gaps. No skip or tolerated difference counts as exact parity.

### Earlier measurements

Exact equality means zero differing RGBA channels. No tolerance, NEAR result, or compile-only result counts as an exact pass.
Unknown counts remain `not measured`. Missing cases do not reduce the full-parity denominator.

| Gate | Expected | Executed | Exact passes | Mismatches | Errors | Timeouts | In-suite skips | Missing or unsupported | Status |
|---|---|---|---|---|---|---|---|---|---|
| Existing 64×64 suite | 58 fixtures | 58 | 58 | 0 | 0 | 0 | 0 | Current sum absent outside this suite | verified |
| Immutable-dependency rerun | Same 58 fixtures | 58 | 58 | 0 | 0 | 0 | 0 | Same missing effect and broader coverage | verified |
| Independent 64×48 comparisons | 4 probes | 4 | 4 | 0 | 0 | 0 | 0 | Does not define full parameter coverage | verified |
| Current effect inventory | 52 effect names | 51 represented by existing suite | Not an effect-wide qualification count | not measured | sum S001 | not measured | not measured | sum | unverified |
| Complete parameter/input/state/platform matrix | not measured | not measured | not measured | not measured | not measured | not measured | not measured | Inventory incomplete | unverified |

The two 58-case runs repeat the same fixtures. They do not establish 116 unique cases.
The suite contains 49 default-effect fixtures, four time/surface fixtures, and five native transition/control fixtures.
`src` and `prev` use dedicated surface fixtures. `isExecutableHydraEffect()` excludes `sum`.
The independent IDs are `solid_rgba`, `osc_time07`, `shape_rotate`, and `gradient_blend`.
The missing effect ID is `sum`. The failed backend probe is `webgpu:hydraOsc`.
All existing fixture IDs and input definitions remain in [the coverage inventory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/coverage-inventory.json).

Current Hydra source changes only `sum` relative to retained definitions. Its committed distribution bundle still matches the retained bundle.
Therefore, a green comparison against that bundle cannot prove current source behavior for `sum`.
No candidate output replaced a golden. No fixture, generator, tolerance, implementation, or workflow changed.

## 4. Evidence

Review CI boundary: No workflow run exists at the inspected source SHA. A passing export dispatch does not qualify rendered parity. Current complete-render enforcement remains an open verification requirement. [Exact-source responses and workflows](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/noisemaker-for-hydra-synth-remote-evidence.json).

The current distribution HTML independently produces `Hydra is not defined` and zero canvases in Chrome. [Probe](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/hydra-synth-html-current.json).

| Command or check | Exit or outcome | Evidence |
|---|---|---|
| `npm test` | 0 | [31 unit and 58 render results](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/npm-test.json), [raw DOM](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/npm-test-dom.html) |
| Existing HTML suite with immutable routing | 58/58 exact | [Log, runtime, and asset hashes](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/immutable-parity.json) |
| Installed nondefault differential probes | 4/4 exact | [Inputs and RGBA hashes](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/independent-differential.json) |
| `npm pack --json --pack-destination <evidence-directory>` | 0 | [28-file inventory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/pack.json) |
| `npm install --ignore-scripts --bin-links=false --no-audit --no-fund <tarball>` | 0 | [Install log](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/install.json) |
| Installed module and README workflow | Useful output and recovery | [Browser result](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/installed-browser.json), [output screenshot](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/installed-output.png) |
| Installed HTML, sum, and WebGPU probes | Explicit failures | [Raw diagnostics](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/distribution-and-recovery.json) |
| `npm run build` in installed candidate | 0, four matching bundles | [Reproduction](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/build-reproduction.json) |
| `npm uninstall --ignore-scripts --bin-links=false --no-audit --no-fund noisemaker-for-hydra-synth` | 0, package absent | [Removal log](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/removal.json) |
| `gh api repos/noisefactorllc/noisemaker-for-hydra-synth/actions/workflows` | 0, zero workflows | [GitHub preflight](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/preflight.json) |
| `npm view noisemaker-for-hydra-synth version dist --json` | 1, E404 | [Registry response](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/registry.json) |

The suite uses 16,384 channels per image. Independent probes use 12,288 channels per image.
Actual and reference RGBA files accompany the independent results. All tracked files retain source hashes in [the source inventory](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/source-hashes-before.json).
The initial Python fetch failed local certificate trust. Curl succeeded with certificate validation enabled.
Initial resize sampling omitted the caller's canvas update. The corrected observation changes both canvas and pipeline dimensions.
The raw failed attempts remain visible. Neither probe limitation counts as a product defect.

Official references: [Hydra documentation](https://hydra.ojack.xyz/docs/docs/learning/getting-started/) and [npm metadata documentation, CLI 11.19.1](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
The audit inspected both references on 2026-09-24. Full editor behavior does not follow from this module's integration contract.

## 5. Open compatibility limits

Next bounded check: Repair the packed HTML in the implementation job, then open the npm tarball example without checkout-only files. Require a rendered first frame, editable parameters, and recovery from invalid input. Rerun all 58 browser cases with both authority hashes recorded, then account for missing API, WGSL, and current-catalog cases.
See the stable entries in [completion gaps](COMPLETION_GAPS.md).

See [completion gaps](COMPLETION_GAPS.md#4-known-gaps) for stable IDs, dependencies, and acceptance criteria.

1. Reconcile `sum`, immutable references, and full expected coverage in GAP-001.
2. Correct the installed HTML example in GAP-004. Require useful pixels and zero page errors.
3. Complete parameter, input, state, size, and backend qualification for GAP-001.
4. Complete host, upgrade, and resource checks for GAP-002.
5. Supply and check the source-update gate for GAP-005 through existing CI.
6. Complete package metadata, notices, dependency, and release checks for GAP-003.

All eligible ports retain equal priority. Full parity requires no missing or skipped cases.
The implementation job owns corrections. This audit does not advance the parity checkpoint.

## 6. History

2026-09-25 daily review at `073f16d2c94140c55433e6beeb3d76f372b93700`: source freshness and bounded evidence reviewed. Open qualification limits retained. [Retained review evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/review-20260925-053200/hydra-synth-browser-tests.json). No new closure claimed.

| Date | Source | Result | Change |
|---|---|---|---|
| 2026-09-24, initial report | `be5d53bc928b9ed641332db48d849354d0d5d0bb` | 30 Node tests. Full qualification unverified. | Created the report with no browser sweep or installed qualification. |
| 2026-09-24, audit | `8e77ffccf410c05d9812daf5e7262bc5e55fc567` | 31 unit passes, 58 exact suite cases, four independent exact probes. Full parity remains unqualified. | Added installed evidence, immutable references, source reconciliation, sum and WebGPU limits, broken HTML, and absent CI. |

Initial run: `20260924-remaining-gap-documents`. [Retained initial report](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/before-COMPATIBILITY.md).
Current run: `audit-20260924-170142`. [Current operational evidence](/Users/alex/.codex/automations/noisemaker-port-completion-audit/evidence-audit-20260924-170142/).
The containing commit and shared publication record identify the published documents. Documentation publication does not qualify the port for release.
