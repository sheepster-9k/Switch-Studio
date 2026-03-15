# Changelog

All notable changes to Switch Manager Studio are documented here.

## [2.1.3] - 2026-03-15

### Fixed
- **SSRF prevention**: auth session endpoint now rejects `haBaseUrl` values that don't start with `http://` or `https://`
- **Path traversal prevention**: blueprint `:id` route parameters are validated with the existing `sanitizeBlueprintId` allowlist
- **Auth DoS prevention**: `DELETE /api/auth/session` now requires an active session before allowing sign-out
- HA WebSocket `auth_invalid` handler now calls `cleanup()` to clear stale `connectPromise` state
- mmWave lazy bridge no longer permanently bricks after activation failure (`this.activating` cleared unconditionally)
- mmWave MQTT telemetry `target_count` is clamped to 0–64 to prevent unbounded loops from untrusted payloads
- mmWave broadcast no longer mutates the socket Set during iteration (collects failed sockets, then removes)
- Tar archive builder throws on filenames exceeding the 100-byte POSIX limit instead of silently truncating
- Config sort in snapshot builder falls back to `localeCompare` when config IDs are non-numeric (prevents NaN comparisons)
- `stableAutomationId` now correctly falls through to `JSON.stringify` for automations with neither alias nor description
- `loadAutomations` gracefully returns an empty array when `automations.yaml` does not exist (ENOENT)
- Redundant condition guard removed in `inferAutomationMatch` (the `!buttonMatches` check was always sufficient)
- `callEntityControl` validates that `select_option` receives a string and `set_value` receives a defined value
- Metadata store deep-clones via `cloneValue` (prefers `structuredClone`) instead of `JSON.parse(JSON.stringify())`
- mmWave WebSocket upgrade path uses `endsWith("/ws/mmwave")` so it works under HA ingress proxy prefixes
- `areaDisplayLabel` guards against undefined `labels[kind]` or `labels[kind][slot]`
- `fetchDeviceImage` API client now fires `AUTH_EXPIRED` event on 401 responses
- `ZERO_DURATION` is now frozen to prevent accidental mutation via `parseDuration` return
- Duration string millisecond parsing pads fractional digits to 3 (`"0:05:30.5"` → 500ms, not 5ms)
- Sequence/condition/trigger remove handlers use post-filter length instead of stale pre-removal length
- `DelayStepEditor.updatePart` guards against null `parts` to prevent stale-closure crash
- Blueprint grid loops guard against zero `cellWidth`/`cellHeight` to prevent infinite loops
- `SensorPanel` clears `imageError` when the selected blueprint changes
- `fallbackPathBounds` and `blueprintViewBox` use loop-based min/max instead of `Math.min(...spread)` to avoid stack overflow on large SVGs
- `useCornerCapture` rect calculation uses loop-based min/max instead of spread
- `useDraftConfig.updateDraft` only marks dirty when the draft is non-null

## [2.1.2] - 2026-03-15

### Fixed
- Automation export now throws on corrupt `automations.yaml` instead of silently discarding existing entries; writes are atomic (temp file + rename)
- Profile store operations (create, update, delete, import) are now serialized with a write mutex to prevent interleaved read-modify-write corruption
- Area label store writes are now serialized with a write mutex
- Blueprint image override writes are now atomic (temp file + rename)
- mmWave target expiry, cache write, and idle shutdown timers now call `.unref()` so they don't prevent clean process exit
- MQTT `publishDevice` now guards against publishing to unknown devices
- Fatal startup errors are now caught and logged instead of producing an unhandled rejection
- Entity control validates entity ID format before domain extraction
- Automation export validates `buttonIndex`/`actionIndex` are non-negative integers
- `getNestedValue` uses `isRecord` guard instead of raw object cast
- Config normalization filters non-string entries from `propertyEntityIds`
- Metadata deep-cloned in `hydrateConfigLinks` to prevent mutation of source configs
- Config port and request timeout fall back to defaults on invalid env var values
- HA WebSocket message parsing errors after authentication are now logged instead of silently swallowed
- mmWave idle deactivation catches errors instead of producing unhandled rejection
- Learning session poll adds cancellation token to prevent state updates after cleanup
- `SequenceEditor.duplicateStep` guards against out-of-bounds index
- `downloadNameFromDisposition` falls back correctly on empty filename captures
- `ConfigRail` device/entity Maps are now memoized with `useMemo` instead of recreated every render
- `AUTH_EXPIRED` event handler uses refs to avoid stale closure over `resetStudioState`/`setLoading`/`setBlockingError`
- Config deletion now clears the draft immediately instead of waiting for the studio reload

## [2.1.1] - 2026-03-15

### Fixed
- **Area assignments now persist across restarts** — HA's Switch Manager backend does not round-trip the `metadata` field, so area assignments (and layout overrides) were silently lost on every page refresh or add-on restart. Added a local sidecar JSON store (`data/config-metadata.json`) that persists metadata independently of HA. On snapshot load, sidecar metadata is merged back into configs before hydration.
- Config deletion now cleans up the sidecar metadata entry

## [2.1.0] - 2026-03-15

### Fixed
- Automation matching now prefers the most specific button/action (most conditions matched) instead of blindly returning the first unconditioned match — fixes false-positive matches on blueprints where button 0 has no conditions
- WebSocket client is now captured per-request, preventing auth session changes from corrupting in-flight API requests — previously, changing auth mid-request could close the WebSocket out from under concurrent handlers

## [2.0.11] - 2026-03-15

### Fixed
- Auth rate limiter off-by-one: allowed 16 attempts per window instead of the intended 15
- Automation export race condition: concurrent exports could lose writes due to unserialized read-modify-write on `automations.yaml` — added in-process mutex
- Ctrl+S keyboard shortcut could invoke a stale `handleSave` closure — now uses a ref to always call the latest version
- mmWave bootstrap hydration timers now call `.unref()` so they don't prevent clean process exit on shutdown

## [2.0.10] - 2026-03-15

### Changed
- Extracted `guardHa` / `guardHaConfig` route guard helpers to replace 21 repeated inline guard blocks across server routes
- Extracted `ensureVirtualAction` helper in `useDraftConfig` to deduplicate virtual action find-or-create logic
- Consolidated near-identical `onUseBlueprint` / `onUseCandidate` handlers via shared `applyNewDraft` helper in App.tsx

## [2.0.9] - 2026-03-15

### Fixed
- `parseDuration` now correctly parses `MM:SS` duration strings — previously it dropped the minutes and used only the first number as seconds (e.g., `"05:30"` became 5s instead of 5m30s)
- Discarding an unsaved draft no longer incorrectly marks the replacement config as dirty
- MQTT message routing now works with multi-segment base topics (e.g., `home/z2m`) — previously only single-segment topics like `zigbee2mqtt` were correctly parsed
- Blueprint image file operations no longer race (TOCTOU) — removed pre-existence checks in favor of direct read/unlink with error handling

### Changed
- `useDraftConfig` Maps (`blueprintsById`, `devicesById`, `entitiesById`) are now memoized with `useMemo` instead of recreated every render
- Dirty detection uses an incremental flag instead of double `JSON.stringify` comparison on every render
- Consolidated duplicate `WorkspaceMode`, `AutomationTarget`, and `NoticeState` type definitions into `helpers.tsx`
- Replaced `finiteOr` with shared `asNumber` utility across mmWave modules
- Replaced inline `error instanceof Error` checks with shared `errorMessage()` in BlueprintPanel and SensorPanel
- Pre-stringify automation objects in discovery scoring to avoid O(D*A) serialization
- Replaced inline `Math.max/Math.min` with shared `clamp()` in App.tsx
- Replaced duplicated `moveStepToIndex` in SequenceEditor with imported `moveSequenceEntry`
- Removed duplicate `WORKSPACE_DETAILS` constant (consolidated into `WORKSPACE_OPTIONS`)

## [2.0.8] - 2026-03-15

### Changed
- Decomposed `server/index.ts` from 2,535 to 767 lines — extracted 7 focused modules: normalization, resolution, blueprintUtils, tarBuilder, snapshot, automations, entityControl
- Decomposed `App.tsx` from 1,186 to 661 lines — extracted 5 custom hooks: useAuthSession, useStudioData, useDraftConfig, useConfigPersistence, useLearningSession
- Extracted 541 lines of pure utility functions from `SequenceEditor.tsx` into `sequence/stepUtils.ts`
- Consolidated duplicate `isRecord`, `asNumber`, `cloneValue`, and `clamp` definitions into `shared/utils.ts`
- No logic changes — purely mechanical extraction and deduplication

## [2.0.7] - 2026-03-15

### Fixed
- Area assignment now works for scene controllers and other configs — HA's Switch Manager integration does not round-trip the `metadata` field, so area sync was silently skipped; the draft's metadata is now carried forward for the sync call
- Config save with metadata is now resilient: if the HA backend rejects the metadata field, the save automatically retries without it
- Area sync errors are now surfaced to the UI as warnings instead of being swallowed silently
- `parseResponse` in the API client now catches non-JSON server responses (e.g., proxy 502 HTML pages) and shows a clean error instead of a raw `SyntaxError`

## [2.0.6] - 2026-03-14

### Fixed
- Automation export now preserves the action's configured mode (`single`, `restart`, `queued`, `parallel`) instead of always hardcoding `single`
- Removed dead `payload` variable in automation export route handler

### Added
- Credits and acknowledgements section in README citing Switch Manager, Home Assistant, Zigbee2MQTT, and key dependencies
- This changelog

## [2.0.5] - 2026-03-14

### Fixed
- `BlueprintPanel.handleFetchDeviceImage` was passing a plain string to `onNotify` instead of the required `{kind, text}` object, causing notifications to silently fail
- `SensorPanel` image operations (import, fetch, reset) were silently swallowing errors with no user feedback — now shows inline error messages
- mmWave runtime cache writes are now atomic (write to temp file, then rename) to prevent corruption on crash

## [2.0.4] - 2026-03-14

### Fixed
- Blueprint image URL now uses a relative path so images load correctly through HA ingress
- Automation export parses existing `automations.yaml` as a YAML array instead of blind string append — handles empty and null files safely
- Profile area writes are now sequential (detection, stay, then interference) to avoid firmware command interleaving
- Profile name/notes form no longer resets when background data refreshes

### Added
- Entity control domain allowlist to prevent service injection via crafted entity IDs
- WebSocket proxy in Vite dev server config so mmWave works in development mode

## [2.0.3] - 2026-03-14

### Fixed
- Supervisor WebSocket auth: added `homeassistant_api: true` so `SUPERVISOR_TOKEN` authenticates with HA Core WebSocket
- mmWave API calls changed from absolute to relative URLs so HA ingress `<base href>` works correctly
- mmWave WebSocket URL now resolves against base href for ingress compatibility
- `INGRESS_ENTRY` is sanitized before HTML injection (XSS prevention)
- Automation export `event_data` is now built incrementally instead of overwriting via spread operators
- WebSocket connection timeout (15s) prevents permanent hangs when HA stalls
- Profile export download: delayed Object URL revocation from immediate to 10s
- `LazyMmwaveBridge` race condition that could create duplicate MQTT connections on concurrent activation

### Added
- `Authorization` header on WebSocket upgrade request for Supervisor proxy compatibility
- Startup REST API token validation with diagnostic logging
- Token source logging in `run.sh`

## [2.0.2] - 2026-03-14

### Fixed
- Auth screen no longer appears when running as a Supervisor add-on with `SUPERVISOR_TOKEN`

## [2.0.1] - 2026-03-14

### Fixed
- Multi-arch Docker build: Vite/rolldown build stage now runs on the CI host platform (`--platform=$BUILDPLATFORM`) to avoid missing native binding errors on armhf/armv7

## [2.0.0] - 2026-03-14

### Added
- First stable release
- Visual editor for Switch Manager configs with button actions and per-button sequencing
- Guided discovery for unmapped devices
- Blueprint-aware editing with layout overrides, rotation, and area assignment
- Virtual multi-press editing
- Learn mode integration
- Automation import and export
- Blueprint package export
- Device property inspection and entity control
- mmWave Studio workspace with live zone editor, teach mode, corner fit, and profile management
- Home Assistant add-on with zero-config Supervisor authentication
- Standalone Docker and Node.js deployment support

### Changed
- UI polish: loading spinners, empty states, card borders, disabled button states, error banners
- Multiple bug fixes from initial code audit
