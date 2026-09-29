# Reproducible Build, Lazy Danmu, and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows builds reproducible, remove host-Node dependence from the packaged danmu runtime, start danmu only when needed, and turn lint/CI into real gates.

**Architecture:** Standardize the repository on npm and Node.js 24.21.0 LTS, pin the packaged Windows x64 Node runtime by archive SHA-256, then switch CI to npm ci and lazy sidecar startup. Packaging scripts become deterministic inputs rather than probes of the build host.

**Tech Stack:** Node.js 24.21.0 LTS, npm 11.19.0, Electron Builder, Vue CLI 5, GitHub Actions, Windows PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-30-my-zyplayer-architecture-hardening-design.md`

**Program Order:** 3 of 4. Prerequisites: security-boundary and settings-secrets plans are complete. This establishes lint, lockfile, runtime, and CI gates before the largest module decomposition.

## Global Constraints

- npm is the only package manager and lockfile authority.
- CI must use npm ci and must not use --package-lock=false.
- Build Node is pinned to 24.21.0 in CI for this project.
- Packaged danmu Node runtime is Node.js 24.21.0 Windows x64 archive `node-v24.21.0-win-x64.zip`.
- Archive SHA-256 is `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`.
- Normal app startup must not spawn the danmu sidecar.
- Loopback binding and random sidecar token remain mandatory.

## Review Focus

- Offline/repeated builds with a warm cache must verify the cached archive checksum rather than trusting cache presence.
- A checksum mismatch or truncated Node archive must fail packaging before any runtime is copied.
- npm ci on a clean checkout must not mutate package-lock.json.
- Two concurrent first danmaku requests must create only one sidecar process.
- App quit during sidecar startup must not leave an orphan Node process.

---

### Task 1: Make Lint a Real Local Gate

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create or Modify: `.eslintrc.js`
- Test: command-level lint gate.

**Interfaces:**
- Produces: `npm run lint` that actually executes ESLint over `src/**/*.{js,vue}` and relevant scripts/tests where compatible.
- Use Vue 2 compatible ESLint configuration; do not mass-reformat existing code.

- [ ] **Step 1: Run the current lint command and record the expected failure**
  Run: `npm run lint`
  Expected: FAIL with the current missing lint command/plugin behavior.
- [ ] **Step 2: Add the minimal Vue 2 ESLint tooling/configuration and targeted ignores needed for generated/vendor code**
- [ ] **Step 3: Run lint and fix only real source violations required to establish the gate**
  Run: `npm run lint`
  Expected: PASS.
- [ ] **Step 4: Run unit suite**
  Run: `npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add package.json package-lock.json .eslintrc.js src && git commit -m "chore: restore executable lint gate"`

### Task 2: Make npm Lockfile Authoritative

**Files:**
- Delete: `yarn.lock`
- Modify: `package.json`
- Regenerate: `package-lock.json`
- Test: clean npm install determinism.

**Interfaces:**
- `package.json` adds `engines.node` pinned to `24.21.x` and `packageManager` matching npm 11.19.0.
- `package-lock.json` contains canonical registry URLs only.

- [ ] **Step 1: Write/run a lockfile validation script or command that fails on yarn.lock and legacy registry hosts**
  Run: `node tests/build-lockfile.test.js` after creating the test.
  Expected: FAIL on current `yarn.lock` and/or legacy lock entries.
- [ ] **Step 2: Under Node 24.21.0 / npm 11.19.0 regenerate package-lock with `--legacy-peer-deps` only if the existing dependency graph still requires it**
  Remove `yarn.lock`.
- [ ] **Step 3: Verify npm ci succeeds and leaves lockfile unchanged**
  Run: `npm ci --legacy-peer-deps --ignore-scripts && git diff --exit-code -- package-lock.json`
  Expected: PASS with no lockfile diff.
- [ ] **Step 4: Restore required Electron install step and run units**
  Run: `node node_modules/electron/install.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add package.json package-lock.json tests/build-lockfile.test.js && git rm yarn.lock && git commit -m "build: make npm lockfile authoritative"`

### Task 3: Pin and Verify the Danmu Node Runtime

**Files:**
- Create: `scripts/node-runtime-manifest.json`
- Create: `scripts/fetch-node-runtime.js`
- Modify: `scripts/prepare-danmu-api-runtime.js`
- Test: `tests/node-runtime-packaging.test.js`

**Interfaces:**
- Manifest Windows x64 entry: version `24.21.0`, archive `node-v24.21.0-win-x64.zip`, SHA-256 `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`, official base `https://nodejs.org/dist/v24.21.0/`.
- Produces: `ensureNodeRuntime({ manifest, cacheDir, download }) -> pathToNodeExe`.
- `prepare-danmu-api-runtime.js` consumes only the verified pinned runtime unless `MY_ZYPLAYER_NODE_RUNTIME` is explicitly supplied and reports exactly version 24.21.0.

- [ ] **Step 1: Write failing packaging tests**
  Cover valid cached archive, checksum mismatch, wrong-version override, and extraction locating `node.exe`.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/node-runtime-packaging.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement manifest fetch/cache/hash/extract flow and replace host-node probing**
- [ ] **Step 4: Run runtime packaging and unit tests**
  Run: `node tests/node-runtime-packaging.test.js && npm run prepare:danmu && build\\danmu-api-runtime\\node.exe --version`
  Expected: tests PASS and version output `v24.21.0`.
- [ ] **Step 5: Commit**
  `git add scripts/node-runtime-manifest.json scripts/fetch-node-runtime.js scripts/prepare-danmu-api-runtime.js tests/node-runtime-packaging.test.js && git commit -m "build: pin packaged danmu node runtime"`

### Task 4: Lazy Danmu Sidecar Startup

**Files:**
- Modify: `src/background.js`
- Modify: `src/main/media-enhancement/local-danmu-runtime.js`
- Modify: `src/main/media-enhancement/danmaku-service.js` or current runtime facade
- Test: `tests/companion-runtime.test.js`
- Test: `tests/danmu-lifecycle.test.js`

**Interfaces:**
- App ready does not call `startLocalDanmuApi()`.
- First local danmaku request calls `startLocalDanmuApi()`; concurrent starts share the existing `startPromise`.
- Quit calls `stopLocalDanmuApi()` even if startup is in progress; startup completion after stop cannot resurrect retained global state.

- [ ] **Step 1: Write failing lifecycle tests**
  Assert zero spawn on initialization, one spawn for two concurrent first requests, and no running child after stop-during-start.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/danmu-lifecycle.test.js`
  Expected: FAIL because background currently warms the sidecar.
- [ ] **Step 3: Remove warmup and harden stop/start race handling**
- [ ] **Step 4: Run danmaku/runtime tests**
  Run: `node tests/danmu-lifecycle.test.js && node tests/companion-runtime.test.js && node tests/danmaku-matching.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/background.js src/main/media-enhancement tests/danmu-lifecycle.test.js tests/companion-runtime.test.js && git commit -m "perf: start local danmu runtime on demand"`

### Task 5: Move CI and Packaging to Node 24.21.0 + npm ci

**Files:**
- Modify: `.github/workflows/quality.yml`
- Modify: `.github/workflows/windows-regression.yml`
- Modify: `.github/workflows/windows-installer.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/x86.yml` if it remains supported

**Interfaces:**
- All maintained workflows use `actions/setup-node@v4` with `node-version: '24.21.0'`.
- Dependency installation uses `npm ci --legacy-peer-deps` only if required by the locked graph; no workflow passes `--package-lock=false`.
- Quality workflow runs `npm run lint` before unit/build tests.

- [ ] **Step 1: Add a static workflow test that fails on Node 16, `npm install`, or `--package-lock=false` in maintained workflows**
  Test: `tests/workflow-policy.test.js`.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/workflow-policy.test.js`
  Expected: FAIL on current workflows.
- [ ] **Step 3: Update workflows to the pinned toolchain and npm ci**
- [ ] **Step 4: Run policy, lint, unit, and build locally**
  Run: `node tests/workflow-policy.test.js && npm run lint && npm test && npm run build`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add .github/workflows tests/workflow-policy.test.js && git commit -m "ci: pin supported node and npm ci"`

### Task 6: Prove Reproducible Windows Package

**Files:**
- Modify: `tests/electron-e2e.js` only if runtime version diagnostics need assertion support.
- Modify: `package.json` scripts only if a deterministic verification command is needed.

**Interfaces:**
- Packaged `resources/danmu-api/runtime.json` reports Node `v24.21.0`.
- Installer build does not depend on a system-installed Node copy beyond the build toolchain itself.

- [ ] **Step 1: Clean generated build outputs and prepare runtime twice, asserting identical runtime manifest/hash metadata**
  Run: `npm run prepare:danmu` plus the deterministic verification script added in this task if needed.
  Expected: PASS both times.
- [ ] **Step 2: Build Windows x64 installer from the pinned toolchain**
  Run: `npm run electron:build -- --win --x64 --publish never`
  Expected: PASS and `dist_electron/*.exe` exists.
- [ ] **Step 3: Verify packaged runtime and run Windows E2E**
  Run: packaged runtime `node.exe --version` plus `npm run test:e2e -- --in-place`.
  Expected: `v24.21.0` and E2E PASS.
- [ ] **Step 4: Run final quality suite**
  Run: `npm run lint && npm test && npm run test:douban && npm run test:douban:match-e2e && node tests/navigation-audit-e2e.js`
  Expected: PASS.
- [ ] **Step 5: Commit any verification-only adjustments**
  `git add package.json tests/electron-e2e.js && git commit -m "test: verify reproducible windows runtime packaging"`