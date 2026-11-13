# Autopass Desktop

A desktop workspace for persistent Autopass entries, built with Electron, React,
TypeScript, and Pear Runtime.

## Features

- Add, list, and remove entries with validation and duplicate-name protection.
- Search names without case sensitivity, with matching counts and live refresh.
- Open entry details and explicitly reveal or hide values. Switching entries or
  closing details hides the value again.
- Dark interface with keyboard focus indicators and a layout for smaller windows.
- A separate Bare worker for Autopass storage, networking, and Pear OTA updates.

## Run locally

Use Node.js 24.16.0 and npm 11.13.0 for dependency installation and project scripts.

```sh
npm ci
npm start
```

`npm start` builds the renderer with Vite and launches Electron with OTA updates
disabled. Entries persist between launches. The native application and bundle
name is `HelloPear`.

For renderer hot reload, run `npm run dev:renderer` in one terminal. In a second
PowerShell terminal, point Electron at that development server:

```powershell
$env:PEAR_DEV_SERVER_URL = 'http://127.0.0.1:5173'
npm start
```

Run `Remove-Item Env:PEAR_DEV_SERVER_URL` when returning to the built renderer.
Pass `--storage <absolute-directory>` after `npm start --` to use an isolated
store for another instance.

## How it works

```text
React UI -> renderer/autopass.ts -> window.bridge (sandboxed preload)
         -> Electron main process -> FramedStream pipe
         -> Bare worker -> Autopass / Corestore
```

The React UI uses typed requests and subscriptions. The preload exposes specific
IPC methods; the main process brokers messages and starts the worker. The renderer
has no direct filesystem or Node.js access.

The worker validates entry operations and persists data in an Autopass Corestore
at `<storage>/app-storage/autopass`, separate from the updater's store. Development
uses the system temporary directory under `pear/HelloPear` by default; installed
builds use a platform-specific application data directory.

Autopass changes notify the UI to refresh its list. Requests carry correlation
IDs, and overlapping refreshes are coalesced so an older snapshot cannot replace
newer data. Hidden detail values are absent from the DOM until revealed.

Autopass manages its own peer replication. Invitation and pairing controls are
not exposed in the desktop UI.

OTA also runs in the Bare worker. Packaged builds can download newer bundles
from the configured Pear upgrade feed. Supported installed builds can apply a
downloaded update and relaunch; development runs cannot apply updates. Apply
failures remain visible and require an application restart before retrying.

## Tests and packaging

```sh
npm run lint
npm run typecheck
npm test
npm run package
npm run test:worker
npm run test:peers
npm run test:desktop
```

`npm test` runs service, React UI, update, build, and preload bridge tests. The
worker, peer, and desktop smoke tests use a fresh packaged build and isolated
stores under `out/`; the peer test uses a local DHT.

`npm run package` creates a runnable application under
`out/HelloPear-<platform>-<arch>/`. `npm run make` creates installers and may require
platform SDKs and signing configuration. ASAR stays disabled so Bare workers can
start from real file paths.
