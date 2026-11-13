# Desktop architecture

> Read before editing `electron/`, `renderer/`, or `workers/`, or debugging
> startup and IPC. These notes describe the current app and its contracts.
> Index: [AGENTS.md](../AGENTS.md).

React UI → `renderer/autopass.ts` → `window.bridge` → Electron main →
FramedStream pipe → `workers/main.js` running in Bare.

- The sandboxed renderer handles presentation. The preload exposes specific IPC
  methods; Electron main creates windows, starts workers, and forwards messages.
- Autopass, its storage/networking, and the Pear updater run in the Bare worker.
- Preload binary events use `Uint8Array` views that preserve byte offsets and
  lengths. Electron 45's sandbox has no `Buffer` global; keep Node builtins out
  of the preload rather than weakening sandboxing.

## Worker and IPC contracts

- The worker identity is `'/workers/main.js'`, including the leading `/`. The
  renderer, main process, and IPC channel names must use the same specifier.
  The broker accepts renderer-provided specifiers without an allowlist.
- `getWorker()` passes six arguments in this order: `updates`, `version`,
  `upgrade`, bundle name (`productName` plus extension), storage directory,
  installed-app path. Desktop worker reads skip the executable and entry path.
- Both pipe endpoints use FramedStream. Payloads are UTF-8 strings: entry
  operations use JSON; OTA controls retain raw `updating`, `updated`,
  `pear:applyUpdate`, `pear:updateApplied`, and `pear:updateFailed ...` messages.
- Worker events are broadcast to all windows. Workers are cached by specifier;
  a later start/apply request can create a replacement after an exit.

## Entry requests and subscriptions

- Operations are `entries:list`, `entries:add`, and `entries:remove`, with
  `:result` or `:error` replies. String `requestId` values are echoed; the renderer
  matches both ID and operation. The raw `entries:list` request remains accepted.
- The worker waits for Autopass readiness, validates trimmed names/text values,
  rejects duplicate local additions, and reserves names during pending adds.
  This does not enforce duplicate-name protection across independent peers.
- Autopass `update` events produce `entries:changed`. The renderer subscribes
  before listing, coalesces concurrent refreshes, and discards superseded reads.
  Unsubscribing aborts a pending read and removes listeners. Requests reject on
  timeout or worker exit; JSON logging records message types, not entry values.

## Build and storage details

- On Windows, extensionless `./App` can resolve the legacy `app.js`. The React
  entry imports `./App.tsx`; TypeScript enables `allowImportingTsExtensions` with
  `noEmit`. Forge builds the renderer before start/package/make.
- Bare resolves worker modules against this project's imports/dependencies.
  Node builtins need Bare mappings, and packaged boot must be checked separately.
- Paparam rejects unknown flags and positionals before startup; every supported
  launch argument must be declared in `electron/main.js`.
- The worker storage directory contains `pear-runtime/corestore` for updates and
  `app-storage/autopass` for the separate Autopass Corestore.
- [OTA behavior](updates.md) covers the apply cache, deadline, and platform gates.
