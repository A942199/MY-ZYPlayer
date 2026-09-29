# MY-ZYPlayer Architecture Hardening Design

Date: 2026-09-30

## Purpose

Harden MY-ZYPlayer without changing the user-facing playback model or removing current CMS, MyVideo/CSP, Douban, subtitle, danmaku, or manual source-switching behavior.

Success means the renderer loses unrestricted Node/Electron privilege, privileged actions move behind a narrow preload API, source scripts have a clearer runtime boundary, settings and secrets gain explicit ownership, builds become reproducible, danmu starts on demand, and CI enforces real quality gates.

## Constraints

This project must not:

- migrate to Vue 3;
- replace xgplayer or Dexie;
- remove working providers merely to simplify architecture;
- change the Japanese / Japanese-Chinese subtitle policy;
- enable subtitles automatically;
- introduce automatic source switching;
- change existing Douban/CMS/BD matching semantics without a regression-backed reason;
- require cloud services for settings, secrets, playback, subtitles, or danmaku.

Implementation is incremental. Every stage must leave the application runnable and testable.

## Current risks

### Renderer privilege

The current BrowserWindow enables Node integration, disables context isolation and web security, and enables Electron remote access. Renderer components directly import Electron and @electron/remote, so renderer compromise has host-level impact.

### Remote source scripts

MyVideo/CSP JavaScript is downloaded from configured URLs and executed in a Worker plus Node vm. Existing memory limits, method allowlisting, timeouts, and disabled WASM are useful, but source identity, network capability, and integrity policy are still too implicit.

### Oversized modules

Play.vue, Film.vue, Douban.vue, Setting.vue, site/tools.js, and media-enhancement/runtime.js combine many responsibilities. Play.vue in particular mixes UI, player lifecycle, source resolution, playback headers, history, mini mode, subtitles, danmaku, and episode state.

### State ownership

Components mutate Dexie directly while Vuex, component state, main-process maps, and workers maintain overlapping state. This makes stale snapshot races possible.

### Build reproducibility

The repository contains both npm and Yarn lockfiles, CI installs without honoring package-lock, and the danmu packaging script copies a compatible Node executable from the build host.

## Target architecture

The target has six boundaries:

1. Renderer UI with no direct Electron, Node, filesystem, process, or remote access.
2. Preload bridge exposing narrow domain APIs through contextBridge.
3. Electron main services for window, playback, Douban, source runtime, media enhancement, settings/secrets, shell, and updater operations.
4. MyVideo source runtime retaining Worker plus vm initially, but with explicit capability and integrity policy.
5. Danmu sidecar using a pinned runtime and lazy lifecycle.
6. Persistence split between normal Dexie settings and encrypted main-process secret storage.

## Electron security boundary

Production BrowserWindow webPreferences must end at:

- nodeIntegration false;
- contextIsolation true;
- no Electron remote module;
- webviewTag false;
- allowRunningInsecureContent false;
- webSecurity true.

Navigation denial and window-open denial remain as defense in depth.

### Preload API

Expose domain APIs rather than raw ipcRenderer. The API should cover window controls, playback resolution/header scopes, Douban, source runtime, media enhancement, settings/secrets, updater, and safe external links.

There must be no generic invoke(channel, payload) escape hatch. Main-process handlers validate type, size, URL scheme, expected fields, and where practical the sender window.

External URL opening accepts only http and https schemes.

Provider secrets are write-only from the renderer perspective. The preload bridge may expose configured/not-configured flags and update/clear operations, but it must not expose an API that returns stored plaintext secrets.

## Playback request scoping

Replace the current origin-only playback header map with a scoped record containing a scope id, target origin, optional path prefix, headers, and expiry.

A playback scope is created or refreshed when a source resolves and is cleared on source change, teardown, or expiry. Headers must not leak to unrelated paths or origins.

Global Origin and Referer rewriting should be reduced to the minimum compatibility rules and covered by provider regressions.

Before webSecurity is re-enabled, introduce a scoped playback network policy in the main process. For active playback scopes only, it may adjust request headers and the minimum CORS response headers required by HLS/MP4 compatibility. It must match the active origin/path scope and must not act as a global CORS bypass. Remove the global OutOfBlinkCors disable switch only after Windows playback E2E proves scoped compatibility.

## MyVideo / CSP runtime hardening

Keep the current Worker plus vm runtime for compatibility, but enforce these invariants:

- source scripts use only http or https;
- source and config fetches reject loopback, link-local, private-network, and metadata-service destinations by default, including redirect targets and resolved IP addresses; explicit compatibility exceptions must be narrow and tested;
- response sizes stay bounded;
- downloaded source code is SHA-256 hashed;
- a known source may optionally pin an expected SHA-256; an unexpected hash change is surfaced in diagnostics and must never silently grant broader capabilities such as dynamic code generation;
- diagnostics record source key, URL, hash, load time, and dynamic-code policy;
- dynamic string code generation remains disabled by default;
- compatibility exceptions are explicit policy entries rather than scattered filename magic;
- sandbox capability remains limited to approved fetch, storage, crypto, parsing, timer, and logging helpers;
- require, process, filesystem, child process, and Electron are never exposed;
- method names remain hard allowlisted;
- worker calls retain timeout and memory limits.

This phase does not claim that Node vm is a perfect malicious-code sandbox. A dedicated child process may replace it later after compatibility is proven.

## Playback decomposition

Play.vue becomes a UI/orchestration component. Extract incrementally:

### PlaybackSession
Owns current media identity, episode/index, resolved URL, source metadata, stale-generation token, and teardown lifecycle.

### PlayerAdapter
Owns xgplayer creation, HLS/MP4 selection, load, seek, rate, volume, event subscription, and destroy.

### SourceResolver
Owns playlist selection, MyVideo marker resolution, parser fallback, playback-header scope creation, and normalized resolved output.

### EpisodeController
Owns manual next/previous selection, index normalization, and stale async protection. It must not add automatic source switching.

### MediaEnhancementService
Owns renderer-side subtitle/danmaku lifecycle and media identity while provider networking remains in main.

## Media enhancement decomposition

Split the current main-process runtime into focused modules:

- media/config.js for normalization and validation;
- media/http-client.js for bounded HTTP and URL policy;
- media/danmaku-service.js for danmaku provider orchestration;
- media/subtitle-service.js for subtitle provider search and ranking;
- media/subtitle-format.js for ZIP, SRT, ASS, and VTT parsing;
- media/ipc.js for IPC registration only;
- media/local-danmu-runtime.js for sidecar lifecycle.

Japanese / Japanese-Chinese content validation stays mandatory and subtitle requests stay opt-in.

## Settings and secret storage

Introduce a SettingsRepository boundary so components stop directly mutating Dexie snapshots. Required operations are get and updatePatch, with patch writes merging against the latest stored record.

Move provider secrets out of IndexedDB:

- DandanPlay secret;
- compatible danmaku bearer token;
- Jimaku API key;
- ASSRT token;
- OpenSubtitles API key;
- SubDL key.

The main process stores an encrypted blob with Electron safeStorage under app user data. Renderer code never reads persisted secret plaintext back; it receives only configured flags and can submit replacement or clear operations. If safeStorage is unavailable, secret persistence fails closed rather than silently falling back to plaintext.

Migration is idempotent: read legacy plaintext, encrypt and persist, verify by reading back, then clear plaintext secret fields while retaining non-secret provider URLs and preferences.

## Reproducible builds

npm becomes the only package manager. Remove yarn.lock, repair/regenerate package-lock against the canonical registry, and use npm ci in CI. Do not use package-lock=false.

Declare supported build Node versions explicitly.

The packaged danmu Node runtime must be pinned by version, platform, architecture, and SHA-256. Packaging downloads or cache-reuses that exact artifact and verifies the checksum. It must not copy an arbitrary compatible Node from the host machine.

## Danmu sidecar lifecycle

Remove unconditional startup on Electron ready.

New lifecycle:

- app startup leaves sidecar stopped;
- first danmaku resolution starts it;
- concurrent first requests share one start promise;
- playback without danmaku never spawns the sidecar;
- app quit always terminates it;
- loopback binding and the random token remain mandatory.

## Quality gates

The existing lint script must become real and CI-enforced.

Keep existing unit, Douban, MyVideo compatibility, playback, media enhancement, danmaku, Windows Electron E2E, and navigation audit coverage.

Add regressions proving:

- hardened BrowserWindow preferences;
- preload exposes only documented APIs;
- malformed IPC is rejected;
- non-http(s) external URLs are rejected;
- renderer APIs cannot read stored provider secret plaintext;
- scoped CORS/header compatibility affects only the active playback scope;
- source/config HTTP rejects private-network and redirect-based SSRF targets;
- playback headers do not leak outside their scope;
- concurrent settings patches preserve unrelated fields;
- secret migration removes plaintext values;
- normal startup does not spawn danmu;
- unsupported source URL schemes and methods are rejected;
- pinned Node checksum mismatch fails packaging.

## Staged implementation

### Stage A: foundation

Repair lint, add architecture/security regression tests around current behavior, and introduce IPC contract helpers without switching renderer behavior yet.

### Stage B: preload migration

Add preload bridge, migrate all renderer Electron/remote usage, validate IPC, then enable context isolation, disable Node integration/remote, and restore web security with explicit compatibility handling.

### Stage C: settings and secrets

Introduce SettingsRepository, migrate component writes, add safeStorage secret service, and migrate legacy plaintext secrets.

### Stage D: playback decomposition

Extract SourceResolver, PlaybackSession, PlayerAdapter, EpisodeController, and MediaEnhancementService while keeping Play.vue behavior stable.

### Stage E: media-runtime decomposition

Split subtitle, danmaku, HTTP, format, and IPC responsibilities without product behavior changes.

### Stage F: reproducible packaging and lazy sidecar

Unify npm locking, switch CI to npm ci, pin danmu Node, make sidecar lazy, and verify Windows packaging.

Each stage is independently committed and must leave the relevant suite green.

## Compatibility and rollout

This is a refactor, not a feature redesign. Existing tests are contract tests; new tests are added before behavior-moving changes. Do not mix mass formatting or unrelated renaming with architectural changes.

If a provider requires behavior that cannot fit the constrained APIs, document the concrete need and add the smallest explicit compatibility adapter instead of reopening global renderer privilege.

## Completion criteria

The project is complete when:

- renderer source contains no direct Electron or @electron/remote imports;
- BrowserWindow uses hardened production preferences;
- privileged operations use preload APIs and validated IPC;
- provider secrets no longer persist plaintext in Dexie;
- playback headers are scoped;
- Play.vue responsibilities are materially reduced behind tested services;
- media enhancement runtime is split into focused modules;
- danmu starts lazily;
- npm is the only lockfile authority and CI uses npm ci;
- packaged danmu Node is pinned and checksum verified;
- lint is an enforced gate;
- existing and new Windows regression suites pass.

## Deferred work

Out of scope unless a discovered blocker requires it:

- Vue 3 migration;
- xgplayer replacement;
- Dexie replacement;
- OS-level sandbox/container replacement for Worker plus vm;
- UI redesign;
- source ranking/product-policy changes;
- cloud secret storage.
