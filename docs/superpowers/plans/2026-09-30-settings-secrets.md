# Settings Repository and Secret Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate stale whole-record settings writes and move provider credentials out of plaintext IndexedDB into main-process encrypted storage.

**Architecture:** Add an atomic patch-based settings repository over the existing Dexie record, then add a main-process safeStorage-backed secret store and an idempotent legacy migration. Renderer UI receives configured flags only and submits replacement/clear operations; media provider requests merge secrets only inside the main process.

**Tech Stack:** Vue 2.6, Dexie 3, Electron safeStorage, Node fs/path, preload IPC bridge.

**Spec:** `docs/superpowers/specs/2026-09-30-my-zyplayer-architecture-hardening-design.md`

**Program Order:** 2 of 4. Prerequisite: `2026-09-30-electron-security-boundary.md` is complete so the settings secret API can use the hardened preload/IPC boundary.

## Global Constraints

- Normal settings remain in Dexie.
- Provider secrets must not persist plaintext in IndexedDB after migration.
- Renderer code must not receive persisted secret plaintext back.
- If safeStorage encryption is unavailable, secret persistence fails closed rather than falling back to plaintext.
- Migration must be idempotent and must verify encrypted persistence before clearing legacy plaintext.
- Do not change subtitle/danmaku product behavior.

## Review Focus

- Concurrent patches to unrelated settings fields must preserve both updates rather than reintroducing stale-snapshot loss.
- A crash/failure after encrypted write but before Dexie cleanup must be safe to retry without losing secrets.
- A corrupted encrypted secret file must fail closed and leave clear diagnostics instead of returning partial credentials.
- Clearing one provider secret must not erase other provider secrets.
- Existing users with no stored secrets must migrate without creating unnecessary files or changing provider URLs.

---

### Task 1: Atomic SettingsRepository

**Files:**
- Create: `src/lib/settings/repository.js`
- Modify: `src/lib/dexie/setting.js`
- Modify: `src/lib/dexie/index.js`
- Test: `tests/settings-repository.test.js`

**Interfaces:**
- Produces: `createSettingsRepository({ read, write })` with async `get()` and async `updatePatch(patch)`.
- `updatePatch` reads the latest record immediately before merge/write and recursively merges plain-object patches while replacing arrays/scalars.
- Dexie adapter exports `settingsRepository`; legacy `setting.find()` may remain temporarily for reads only.

- [ ] **Step 1: Write failing repository tests**
  Cover simple patch, nested mediaEnhancement patch, array replacement, deletion policy (undefined ignored), and two sequential patches based on a changing backing record.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/settings-repository.test.js`
  Expected: FAIL because repository does not exist.
- [ ] **Step 3: Implement repository and Dexie adapter**
  Keep merge logic pure and separately exported for tests.
- [ ] **Step 4: Run tests**
  Run: `node tests/settings-repository.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/lib/settings src/lib/dexie tests/settings-repository.test.js && git commit -m "refactor: add atomic settings repository"`

### Task 2: safeStorage Secret Store

**Files:**
- Create: `src/main/settings/secret-store.js`
- Test: `tests/secret-store.test.js`

**Interfaces:**
- Produces: `createSecretStore({ safeStorage, fs, filePath })`.
- Methods: `status() -> { available, configured }`, `update(patch)`, `clear(keys)`, `readForMainProcess()`.
- Secret keys: `dandanplayAppSecret`, `compatibleToken`, `jimakuApiKey`, `assrtApiToken`, `openSubtitlesApiKey`, `subdlApiKey`.
- On disk format: JSON envelope with `version:1` and base64 encrypted payload; file written atomically via temporary file + rename.

- [ ] **Step 1: Write failing secret-store tests**
  Use fake safeStorage to cover unavailable encryption, write/read round trip, partial update, single-key clear, corrupted envelope, and atomic temp-file replacement.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/secret-store.test.js`
  Expected: FAIL because store does not exist.
- [ ] **Step 3: Implement the store**
  Never log plaintext secrets.
- [ ] **Step 4: Run tests**
  Run: `node tests/secret-store.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/settings/secret-store.js tests/secret-store.test.js && git commit -m "feat: encrypt provider secrets with safeStorage"`

### Task 3: Idempotent Legacy Secret Migration

**Files:**
- Create: `src/main/settings/secret-migration.js`
- Modify: `src/background.js`
- Test: `tests/secret-migration.test.js`

**Interfaces:**
- Produces: `extractLegacySecrets(settings) -> secretPatch`.
- Produces: `stripLegacySecrets(settings) -> sanitizedSettings`.
- Produces: `migrateLegacySecrets({ readSettings, writeSettingsPatch, secretStore }) -> result`.
- Migration writes encrypted secrets, reads them back for equality verification, then clears plaintext secret fields from Dexie.

- [ ] **Step 1: Write failing migration tests**
  Cover no-op migration, successful migration, encrypted-write failure preserving plaintext, verify failure preserving plaintext, and repeat migration after successful cleanup.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/secret-migration.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement migration and invoke it once during app-ready initialization before renderer settings are consumed**
- [ ] **Step 4: Run migration and unit suites**
  Run: `node tests/secret-migration.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/settings/secret-migration.js src/background.js tests/secret-migration.test.js && git commit -m "feat: migrate plaintext provider secrets"`

### Task 4: Secret IPC and Renderer Configured Flags

**Files:**
- Modify: `src/preload.js`
- Modify: `src/main/ipc/app-ipc.js`
- Modify: `src/lib/platform/api.js`
- Modify: `src/components/Setting.vue`
- Modify: `src/main/media-enhancement/runtime.js`
- Modify: `src/lib/player/media-enhancement.js`
- Modify: `src/lib/dexie/iniData/iniSetting.json`
- Test: `tests/settings-secret-ipc.test.js`
- Test: `tests/media-enhancement.test.js`

**Interfaces:**
- Preload settings methods: `secretStatus()`, `updateSecrets(patch)`, `clearSecrets(keys)`; there is no plaintext read method.
- Renderer `mediaEnhancement.providers` retains only non-secret fields plus `configured` booleans used for UI.
- Main-process media resolution obtains secrets from `secretStore.readForMainProcess()` and merges them into provider config immediately before provider calls.

- [ ] **Step 1: Write failing tests for no-plaintext renderer contract and main-process merge**
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/settings-secret-ipc.test.js && node tests/media-enhancement.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement IPC/status UI and move secret consumption into main process**
  Password fields become replacement inputs: blank means unchanged, explicit clear action removes the saved value.
- [ ] **Step 4: Run tests**
  Run: `node tests/settings-secret-ipc.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/preload.js src/main/ipc/app-ipc.js src/lib/platform/api.js src/components/Setting.vue src/main/media-enhancement/runtime.js src/lib/player/media-enhancement.js src/lib/dexie/iniData/iniSetting.json tests/settings-secret-ipc.test.js tests/media-enhancement.test.js && git commit -m "refactor: keep provider secrets out of renderer state"`

### Task 5: Replace Whole-Record Settings Writes with Patches

**Files:**
- Modify: `src/App.vue`
- Modify: `src/components/EditSites.vue`
- Modify: `src/components/Film.vue`
- Modify: `src/components/History.vue`
- Modify: `src/components/Play.vue`
- Modify: `src/components/Setting.vue`
- Modify: `src/components/Star.vue`
- Modify: `src/lib/site/tools.js`
- Test: `tests/settings-callsite-boundary.test.js`

**Interfaces:**
- Consumes: `settingsRepository.updatePatch(patch)` from Task 1.
- Produces: no component callsites of `setting.update(...)`; each write sends the smallest field patch.

- [ ] **Step 1: Write failing static callsite test**
  Assert renderer/components contain no `setting.update(` and no read-mutate-write sequence for preference writes.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/settings-callsite-boundary.test.js`
  Expected: FAIL listing current callsites.
- [ ] **Step 3: Migrate writes to field patches**
  Keep read-only `setting.find()` compatibility only where necessary; new writes go through repository.
- [ ] **Step 4: Run settings and app unit suites**
  Run: `node tests/settings-callsite-boundary.test.js && node tests/settings-repository.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/App.vue src/components src/lib/site/tools.js tests/settings-callsite-boundary.test.js && git commit -m "refactor: patch settings without stale snapshots"`

### Task 6: Windows E2E Proves Secrets Leave IndexedDB

**Files:**
- Modify: `tests/electron-e2e.js`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: regression proof that saving provider credentials results in configured status while the Dexie settings row contains empty/no secret values.

- [ ] **Step 1: Extend E2E with secret-save and IndexedDB inspection assertions**
- [ ] **Step 2: Run against the pre-change behavior if possible and verify the new assertion fails**
  Run: `npm run electron:build -- --win --x64 --dir && npm run test:e2e -- --in-place`
  Expected: FAIL on plaintext-secret assertion before final integration.
- [ ] **Step 3: Fix any integration gaps found by E2E without weakening the no-plaintext contract**
- [ ] **Step 4: Run full validation**
  Run: `npm test && node tests/settings-repository.test.js && node tests/secret-store.test.js && node tests/secret-migration.test.js && npm run electron:build -- --win --x64 --dir && npm run test:e2e -- --in-place`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add tests/electron-e2e.js && git commit -m "test: verify encrypted provider secret migration"`