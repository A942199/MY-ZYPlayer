# Playback and Media Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Play.vue and media-enhancement runtime coupling without changing playback, episode selection, subtitle, danmaku, or source behavior.

**Architecture:** Extract pure/domain services first behind tests, then integrate them into Play.vue one responsibility at a time. Split the main-process media runtime last, preserving its public exports/IPC service interface as a compatibility facade until callers no longer depend on the monolith.

**Tech Stack:** Vue 2.6, xgplayer 2, HlsJsPlayer, Dexie, Electron preload API, Node HTTP, subtitle/danmaku provider logic.

**Spec:** `docs/superpowers/specs/2026-09-30-my-zyplayer-architecture-hardening-design.md`

**Program Order:** 4 of 4. Prerequisites: electron-security-boundary, settings-secrets, and reproducible-build-danmu-ci plans are complete.

## Global Constraints

- Do not add automatic source switching.
- Do not change existing playlist/source selection semantics.
- Subtitle requests remain opt-in and Japanese / Japanese-Chinese only.
- Existing danmaku matching semantics remain covered by strict regression tests.
- No UI redesign or mass formatting.
- Every extraction must preserve existing public data shapes unless the plan explicitly defines an adapter.

## Review Focus

- Rapid episode changes must not let an older async resolve overwrite the newest episode.
- Player destruction/recreation during source type change must not leak listeners, subtitle overlays, or danmaku timers.
- Parser fallback must preserve current configured/default parser precedence.
- A subtitle candidate with misleading filename but non-Japanese content must remain rejected.
- Local danmaku failure must still allow configured fallback providers without leaving stale UI state.

---

### Task 1: Extract SourceResolver

**Files:**
- Create: `src/lib/playback/source-resolver.js`
- Modify: `src/components/Play.vue`
- Test: `tests/source-resolver.test.js`
- Test: `tests/playback.test.js`

**Interfaces:**
- Produces: `createSourceResolver({ sourceApi, siteRepository, platformApi, getSettings })`.
- Method: `resolve({ siteKey, playlist, preferredFlag, index }) -> { url, kind, headers, headerScopeId, exportable, playlist, index, flag, diagnostics }`.
- Parser fallback precedence remains site parser unless blank/default, then `settings.defaultParseURL`.

- [ ] **Step 1: Write failing resolver tests**
  Cover MyVideo marker resolution, plain m3u8, mp4, parser fallback, empty URL rejection, playback-header registration, and playlist fallback flag behavior.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/source-resolver.test.js`
  Expected: FAIL because resolver does not exist.
- [ ] **Step 3: Move source-resolution logic out of `Play.vue` into the resolver**
- [ ] **Step 4: Run resolver and existing playback tests**
  Run: `node tests/source-resolver.test.js && node tests/playback.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/lib/playback/source-resolver.js src/components/Play.vue tests/source-resolver.test.js tests/playback.test.js && git commit -m "refactor: extract playback source resolver"`

### Task 2: Extract PlaybackSession State Machine

**Files:**
- Create: `src/lib/playback/playback-session.js`
- Modify: `src/components/Play.vue`
- Test: `tests/playback-session.test.js`

**Interfaces:**
- Produces: `createPlaybackSession()` with `beginSelection(identity) -> generation`, `isCurrent(generation)`, `setResolved(generation, result)`, `setEpisode(index)`, `snapshot()`, `reset()`.
- Stale generations may never mutate current state.

- [ ] **Step 1: Write failing generation/race tests**
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/playback-session.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement session and replace ad-hoc generation/state fields in Play.vue where they represent the same concern**
- [ ] **Step 4: Run tests**
  Run: `node tests/playback-session.test.js && node tests/source-resolver.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/lib/playback/playback-session.js src/components/Play.vue tests/playback-session.test.js && git commit -m "refactor: centralize playback session state"`

### Task 3: Extract PlayerAdapter

**Files:**
- Create: `src/lib/playback/player-adapter.js`
- Modify: `src/components/Play.vue`
- Test: `tests/player-adapter.test.js`

**Interfaces:**
- Produces: `createPlayerAdapter({ Player, HlsPlayer, FlvPlayer })`.
- Methods: `create(kind, config)`, `load(url)`, `on(event, handler)`, `off(event, handler)`, `seek(seconds)`, `setVolume(value)`, `destroy()`.
- Adapter owns player instance lifecycle and returns the current underlying player only through `raw()` for legacy integration that has not yet been migrated.

- [ ] **Step 1: Write failing fake-player lifecycle tests**
  Cover create/destroy ordering, switching kind, event cleanup, and idempotent destroy.
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/player-adapter.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement adapter and move `getPlayer` lifecycle branches into it**
- [ ] **Step 4: Run tests**
  Run: `node tests/player-adapter.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/lib/playback/player-adapter.js src/components/Play.vue tests/player-adapter.test.js && git commit -m "refactor: isolate player lifecycle"`

### Task 4: Extract EpisodeController

**Files:**
- Create: `src/lib/playback/episode-controller.js`
- Modify: `src/components/Play.vue`
- Test: `tests/episode-controller.test.js`

**Interfaces:**
- Produces: `createEpisodeController({ length, index })` with `select(index)`, `next()`, `previous()`, `replaceLength(length)`, and `snapshot()`.
- It never changes source automatically and never wraps past list bounds unless current product behavior already does so and the test records it.

- [ ] **Step 1: Write failing boundary/manual-selection tests**
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/episode-controller.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement and route Play.vue episode index mutations through the controller**
- [ ] **Step 4: Run tests**
  Run: `node tests/episode-controller.test.js && node tests/playback.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/lib/playback/episode-controller.js src/components/Play.vue tests/episode-controller.test.js && git commit -m "refactor: isolate manual episode selection"`

### Task 5: Extract Renderer MediaEnhancementService

**Files:**
- Create: `src/lib/player/media-enhancement-service.js`
- Modify: `src/components/Play.vue`
- Test: `tests/media-enhancement-service.test.js`
- Test: `tests/media-enhancement.test.js`

**Interfaces:**
- Produces: `createMediaEnhancementService({ platformApi, DanmakuController, SubtitleController })`.
- Methods: `mount({ root, video, mediaIdentity, config })`, `updateConfig(config)`, `enableSubtitles()`, `disableSubtitles()`, `destroy()`.
- Service owns controller construction/destruction and stale mount token handling.

- [ ] **Step 1: Write failing lifecycle tests with fake controllers/platform API**
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/media-enhancement-service.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement service and replace controller lifecycle blocks in Play.vue**
- [ ] **Step 4: Run tests**
  Run: `node tests/media-enhancement-service.test.js && node tests/media-enhancement.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/lib/player/media-enhancement-service.js src/components/Play.vue tests/media-enhancement-service.test.js && git commit -m "refactor: isolate playback media enhancements"`

### Task 6: Split Media Config and HTTP Policy

**Files:**
- Create: `src/main/media-enhancement/config.js`
- Create: `src/main/media-enhancement/http-client.js`
- Modify: `src/main/media-enhancement/runtime.js`
- Test: `tests/media-config.test.js`
- Test: `tests/media-http-client.test.js`

**Interfaces:**
- Produces: `normalizeProviderConfig(value)` and current cleanup helpers from `config.js`.
- Produces: `requestJson`, `requestBuffer`, `cleanUrl`, timeout/size enforcement from `http-client.js`.
- `runtime.js` re-exports legacy functions needed by existing tests while delegating implementation.

- [ ] **Step 1: Write failing focused tests for config normalization and bounded HTTP behavior**
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/media-config.test.js && node tests/media-http-client.test.js`
  Expected: FAIL.
- [ ] **Step 3: Extract modules without changing provider behavior**
- [ ] **Step 4: Run full media tests**
  Run: `node tests/media-config.test.js && node tests/media-http-client.test.js && node tests/media-enhancement.test.js && node tests/danmaku-matching.test.js`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/media-enhancement/config.js src/main/media-enhancement/http-client.js src/main/media-enhancement/runtime.js tests/media-config.test.js tests/media-http-client.test.js && git commit -m "refactor: split media config and http policy"`

### Task 7: Split Subtitle Formatting and Provider Service

**Files:**
- Create: `src/main/media-enhancement/subtitle-format.js`
- Create: `src/main/media-enhancement/subtitle-service.js`
- Modify: `src/main/media-enhancement/runtime.js`
- Test: `tests/subtitle-format.test.js`
- Test: `tests/media-enhancement.test.js`

**Interfaces:**
- `subtitle-format.js` owns archive/text decoding and SRT/ASS/VTT normalization.
- `subtitle-service.js` produces `resolveSubtitles({ config, media })` and `fetchSubtitle({ config, candidate })`.
- Candidate output keeps existing language labels and only permits `ja` or `ja-zh` after content validation.

- [ ] **Step 1: Write failing format/content-language tests**
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/subtitle-format.test.js`
  Expected: FAIL.
- [ ] **Step 3: Extract subtitle modules and preserve runtime facade**
- [ ] **Step 4: Run media tests**
  Run: `node tests/subtitle-format.test.js && node tests/media-enhancement.test.js && npm test`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/media-enhancement/subtitle-format.js src/main/media-enhancement/subtitle-service.js src/main/media-enhancement/runtime.js tests/subtitle-format.test.js && git commit -m "refactor: split subtitle runtime services"`

### Task 8: Split Danmaku Service and IPC Facade

**Files:**
- Create: `src/main/media-enhancement/danmaku-service.js`
- Create: `src/main/media-enhancement/ipc.js`
- Modify: `src/main/media-enhancement/runtime.js`
- Modify: `src/background.js`
- Test: `tests/danmaku-service.test.js`
- Test: `tests/danmaku-matching.test.js`

**Interfaces:**
- `danmaku-service.js` produces `resolveDanmaku({ config, media })` and accepts injected local/fallback provider resolvers.
- `ipc.js` registers the media domain through the validated app IPC layer.
- `runtime.js` becomes a thin compatibility facade or is removed only after no callers/tests require it.

- [ ] **Step 1: Write failing orchestration tests for local success, local failure + fallback, and no-provider outcome**
- [ ] **Step 2: Run and verify failure**
  Run: `node tests/danmaku-service.test.js`
  Expected: FAIL.
- [ ] **Step 3: Extract danmaku and IPC responsibilities**
- [ ] **Step 4: Run full regression**
  Run: `node tests/danmaku-service.test.js && node tests/danmaku-matching.test.js && npm test && npm run test:douban`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/main/media-enhancement/danmaku-service.js src/main/media-enhancement/ipc.js src/main/media-enhancement/runtime.js src/background.js tests/danmaku-service.test.js && git commit -m "refactor: split danmaku and media ipc services"`

### Task 9: Integration Regression and Play.vue Boundary Check

**Files:**
- Create: `tests/play-component-boundary.test.js`
- Modify: `tests/electron-e2e.js` only if test access needs stable service hooks.

**Interfaces:**
- Consumes all previous tasks.
- Produces a static boundary check proving Play.vue no longer directly owns source resolver construction details, raw player constructor switching, or subtitle/danmaku controller construction.

- [ ] **Step 1: Write the static boundary test and E2E rapid episode/source scenario if missing**
- [ ] **Step 2: Run focused tests**
  Run: `node tests/play-component-boundary.test.js`
  Expected: PASS only after all extractions are integrated.
- [ ] **Step 3: Run Windows E2E and full suite**
  Run: `npm test && npm run test:douban && npm run electron:build -- --win --x64 --dir && npm run test:e2e -- --in-place && npm run test:douban:match-e2e && node tests/navigation-audit-e2e.js`
  Expected: PASS.
- [ ] **Step 4: Commit regression-only changes if any**
  `git add tests/play-component-boundary.test.js tests/electron-e2e.js && git commit -m "test: lock playback service boundaries"`