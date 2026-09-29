# Electron Security Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unrestricted renderer privilege while preserving current playback, Douban, MyVideo/CSP, subtitle, danmaku, updater, clipboard, and window behavior.

**Architecture:** Introduce a narrow preload bridge and validated IPC contracts first, migrate renderer callers to that bridge, then switch BrowserWindow to hardened webPreferences. Playback networking becomes scope-based so webSecurity can be enabled without recreating a global CORS bypass.

**Tech Stack:** Electron 13, Vue 2.6, Node.js, ipcMain/ipcRenderer, contextBridge, xgplayer, Node worker_threads/vm.

**Spec:** `docs/superpowers/specs/2026-09-30-my-zyplayer-architecture-hardening-design.md`

**Program Order:** 1 of 4. No implementation-plan prerequisite.

## Global Constraints

- Do not migrate to Vue 3.
- Do not replace xgplayer or Dexie.
- Do not remove working providers merely to simplify architecture.
- Do not change the Japanese / Japanese-Chinese subtitle policy.
- Do not enable subtitles automatically.
- Do not introduce automatic source switching.
- Do not change existing Douban/CMS/BD matching semantics without a regression-backed reason.
- Renderer source must end with no direct Electron or @electron/remote imports.
- Production BrowserWindow must end with nodeIntegration false, contextIsolation true, no remote module, webviewTag false, allowRunningInsecureContent false, and webSecurity true.
- No generic renderer-controlled IPC channel API is allowed.

## Review Focus

- Cross-origin HLS/MP4 that lacks permissive CORS headers must still play when and only when an active playback scope matches it.
- A source/config URL that redirects to loopback, RFC1918, link-local, or metadata-service space must be rejected before content is consumed.
- A valid IPC channel invoked from a non-application sender must be rejected instead of silently executing privileged work.
- Oversized or malformed IPC payloads must fail deterministically without reaching provider/network code.
- A remote source script hash change must not silently grant dynamic-code capability or reuse stale runtime identity.

---

### Task 1: Hardened BrowserWindow Policy as a Testable Module

**Files:**
- Create: `src/main/security/window-policy.js`
- Modify: `src/background.js:47-65`
- Test: `tests/security-boundary.test.js`

**Interfaces:**
- Produces: `createMainWindowWebPreferences(preloadPath) -> object`.
- Produces: `MAIN_WINDOW_SECURITY_INVARIANTS` containing the six required hardened preferences.

- [ ] **Step 1: Write the failing security policy test**
  Assert `createMainWindowWebPreferences('C:\\preload.js')` returns `preload`, `nodeIntegration:false`, `contextIsolation:true`, `enableRemoteModule:false`, `webviewTag:false`, `allowRunningInsecureContent:false`, and `webSecurity:true`.
- [ ] **Step 2: Run the test and verify it fails**
  Run: `node tests/security-boundary.test.js`
  Expected: FAIL because `src/main/security/window-policy.js` does not exist.
- [ ] **Step 3: Implement the policy module and wire `background.js` to call it**
  Keep the hardened policy centralized; do not yet remove legacy renderer Electron calls in this task.
- [ ] **Step 4: Run the test and verify it passes**
  Run: `node tests/security-boundary.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/security/window-policy.js src/background.js tests/security-boundary.test.js && git commit -m "refactor: define hardened electron window policy"`

### Task 2: Preload Contract and Reusable IPC Guards

**Files:**
- Create: `src/preload.js`
- Create: `src/main/ipc/guards.js`
- Create: `src/lib/platform/api.js`
- Test: `tests/preload-contract.test.js`
- Test: `tests/ipc-guards.test.js`

**Interfaces:**
- Consumes: hardened preload path from Task 1.
- Produces: `getPlatformApi()` returning `window.myzy` in renderer code.
- Produces: `assertAppSender(event, mainWindow)`, `assertPlainObject(value, name, maxBytes)`, `assertHttpUrl(value, name)`, `assertAllowedKeys(value, allowedKeys)`.
- Produces preload domains: `window`, `clipboard`, `shell`, `updater`, `douban`, `sourceRuntime`, `playback`, `media`, `settings`.

- [ ] **Step 1: Write failing tests for the preload surface and guard rejection cases**
  `preload-contract` must prove only the documented domain names are exposed and there is no generic `invoke` method. `ipc-guards` must reject non-http(s) URLs, wrong sender, unknown keys, and payloads over 64 KiB.
- [ ] **Step 2: Run the tests and verify failure**
  Run: `node tests/preload-contract.test.js && node tests/ipc-guards.test.js`
  Expected: FAIL because preload/guards do not exist.
- [ ] **Step 3: Implement preload and guards**
  Preload uses `contextBridge.exposeInMainWorld('myzy', api)`. `src/lib/platform/api.js` throws a clear error when the bridge is absent.
- [ ] **Step 4: Run tests and verify pass**
  Run: `node tests/preload-contract.test.js && node tests/ipc-guards.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/preload.js src/main/ipc/guards.js src/lib/platform/api.js tests/preload-contract.test.js tests/ipc-guards.test.js && git commit -m "feat: add constrained electron preload bridge"`

### Task 3: Validated Domain IPC Registration

**Files:**
- Create: `src/main/ipc/app-ipc.js`
- Modify: `src/main/douban/runtime.js:483-489`
- Modify: `src/main/myvideo/runtime.js:319-335`
- Modify: `src/main/media-enhancement/runtime.js:1004-1011`
- Modify: `src/lib/update/update.js:1-40`
- Modify: `src/background.js`
- Test: `tests/ipc-contract.test.js`

**Interfaces:**
- Consumes: guard functions from Task 2.
- Produces: `registerAppIpc({ ipcMain, getMainWindow, services })`.
- Produces validated channel handlers matching preload domains; updater events remain domain-specific and unsubscribe-capable.

- [ ] **Step 1: Write failing contract tests with a fake `ipcMain`**
  Cover valid Douban call, invalid sender, malformed MyVideo method payload, unsafe external URL, and duplicate updater-listener cleanup.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/ipc-contract.test.js`
  Expected: FAIL because `registerAppIpc` does not exist.
- [ ] **Step 3: Implement domain registration and convert existing registrars to service functions or guarded registrations**
  Do not expose raw Electron objects to renderer callers.
- [ ] **Step 4: Run focused and existing tests**
  Run: `node tests/ipc-contract.test.js && npm test && npm run test:douban`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/ipc src/main/douban/runtime.js src/main/myvideo/runtime.js src/main/media-enhancement/runtime.js src/lib/update/update.js src/background.js tests/ipc-contract.test.js && git commit -m "refactor: validate privileged electron ipc"`

### Task 4: Remove Direct Electron and Remote Usage from Renderer Code

**Files:**
- Modify: `src/App.vue`
- Modify: `src/components/Frame.vue`
- Modify: `src/components/Detail.vue`
- Modify: `src/components/Film.vue`
- Modify: `src/components/History.vue`
- Modify: `src/components/Star.vue`
- Modify: `src/components/Setting.vue`
- Modify: `src/components/Play.vue`
- Modify: `src/lib/site/tools.js`
- Modify: `src/lib/site/myvideo.js`
- Modify: `src/lib/douban/scanner.js`
- Test: `tests/renderer-boundary.test.js`

**Interfaces:**
- Consumes: `getPlatformApi()` and preload domains from Task 2.
- Produces: renderer code that calls `window.myzy` only through `src/lib/platform/api.js`.

- [ ] **Step 1: Write the failing static boundary test**
  Scan renderer-owned files and assert no `require('electron')`, `from 'electron'`, `@electron/remote`, raw `ipcRenderer`, or raw `shell` access remains.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/renderer-boundary.test.js`
  Expected: FAIL listing current renderer imports.
- [ ] **Step 3: Migrate all listed files to the platform API**
  Preserve clipboard, window, proxy/session, updater, Douban, MyVideo, playback-header, subtitle, and danmaku behavior.
- [ ] **Step 4: Run renderer boundary and unit suites**
  Run: `node tests/renderer-boundary.test.js && npm test && npm run test:douban`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/App.vue src/components src/lib/site src/lib/douban src/lib/platform tests/renderer-boundary.test.js && git commit -m "refactor: move renderer electron access behind preload"`

### Task 5: Scoped Playback Network Policy

**Files:**
- Create: `src/main/playback/network-policy.js`
- Modify: `src/main/myvideo/runtime.js`
- Modify: `src/background.js`
- Modify: `src/preload.js`
- Modify: `src/lib/platform/api.js`
- Modify: `src/components/Play.vue`
- Test: `tests/playback-network-policy.test.js`

**Interfaces:**
- Produces: `createPlaybackNetworkPolicy()` with `registerScope({url,pathPrefix,headers,ttlMs}) -> scopeId`, `clearScope(scopeId)`, `applyRequest(url,headers)`, `applyResponse(url,responseHeaders)`.
- A scope matches exact origin plus optional normalized path prefix; default TTL is 10 minutes.
- CORS response adjustment is permitted only for an active matching scope.

- [ ] **Step 1: Write failing scope isolation tests**
  Assert headers apply to matching origin/path, do not apply to sibling path or other origin, expiry removes access, and CORS response headers are altered only for the matching active scope.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/playback-network-policy.test.js`
  Expected: FAIL because the policy does not exist.
- [ ] **Step 3: Implement the policy and replace origin-only playback header storage**
  Add request and response webRequest hooks through the policy. Clear the current scope during source change/player teardown.
- [ ] **Step 4: Run playback and policy tests**
  Run: `node tests/playback-network-policy.test.js && node tests/playback.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/playback src/main/myvideo/runtime.js src/background.js src/preload.js src/lib/platform/api.js src/components/Play.vue tests/playback-network-policy.test.js && git commit -m "fix: scope playback network privileges"`

### Task 6: MyVideo Source Fetch Integrity and SSRF Policy

**Files:**
- Create: `src/main/security/network-target.js`
- Modify: `src/main/myvideo/runtime.js`
- Modify: `src/main/myvideo/runtime.worker.js`
- Test: `tests/myvideo-security.test.js`
- Test: `tests/myvideo.test.js`

**Interfaces:**
- Produces: `assertPublicHttpTarget(url, { lookup }) -> Promise<URL>` rejecting non-http(s), loopback, private, link-local, multicast, unspecified, and metadata targets for both initial and redirect destinations.
- Produces: `sha256Text(code) -> lowercase hex`.
- Runtime identity includes normalized source identity, configuration identity, script URL, and script SHA-256.
- Dynamic-code compatibility policy is explicit and never inferred from a changed hash.

- [ ] **Step 1: Write failing security tests**
  Cover `file:`, `javascript:`, `127.0.0.1`, `::1`, `169.254.169.254`, RFC1918 DNS resolution, public DNS resolution, redirect-to-private rejection, deterministic script hash, and hash change creating a new runtime identity.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/myvideo-security.test.js`
  Expected: FAIL because target validation/hash identity is missing.
- [ ] **Step 3: Implement the target policy and integrate it into source/config loading and redirects**
  Preserve response byte limits, worker memory limits, method allowlist, and existing compatibility sources.
- [ ] **Step 4: Run MyVideo suites**
  Run: `node tests/myvideo-security.test.js && node tests/myvideo.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/security/network-target.js src/main/myvideo/runtime.js src/main/myvideo/runtime.worker.js tests/myvideo-security.test.js tests/myvideo.test.js && git commit -m "fix: harden remote source runtime inputs"`

### Task 7: Flip the Security Switch and Prove Windows Compatibility

**Files:**
- Modify: `src/background.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/electron-e2e.js`
- Test: `tests/security-boundary.test.js`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: no `OutOfBlinkCors` switch, no `@electron/remote` dependency, hardened BrowserWindow preferences active in production.

- [ ] **Step 1: Extend Windows E2E to assert bridge availability and renderer Node absence**
  Assert `window.myzy` exists, `typeof require === 'undefined'` in the renderer, and current mock playback still reaches first frame / expected request assertions.
- [ ] **Step 2: Run E2E and verify it fails before the final security flip**
  Run: `npm run electron:build -- --win --x64 --dir && npm run test:e2e -- --in-place`
  Expected: FAIL on the renderer security assertion.
- [ ] **Step 3: Remove remote initialization/dependency, remove `OutOfBlinkCors`, and activate hardened preferences**
  Keep only the scoped compatibility policy from Task 5.
- [ ] **Step 4: Run full validation**
  Run: `npm test && npm run test:douban && node tests/security-boundary.test.js && node tests/renderer-boundary.test.js && npm run electron:build -- --win --x64 --dir && npm run test:e2e -- --in-place && npm run test:douban:match-e2e && node tests/navigation-audit-e2e.js`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/background.js package.json package-lock.json tests/electron-e2e.js tests/security-boundary.test.js && git commit -m "feat: enforce hardened electron renderer boundary"`