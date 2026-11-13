# AGENTS.md

Autopass Desktop uses Pear Runtime, Electron, React, TypeScript, and CSS Modules.
The renderer communicates with Autopass through Electron IPC and a Bare worker.
[README](README.md) explains local setup, features, and checks.

Key fact: **the OTA updater does not run in Electron.** `electron/main.js` only
spawns a Bare sidecar (`workers/main.js`) and pipes bytes; the updater lives in the
worker.

## Commands

npm only — pnpm breaks `forge.config.js` (undeclared hoisted `pear-link`).

```sh
npm start                            # dev, updates OFF
npm start -- --storage <dir>         # second instance / custom storage
npm run lint                         # prettier --check . && lunte
npm run format                       # prettier --write . && lunte --fix
npm run typecheck                    # app + Vitest TypeScript
npm test                             # service + UI + OTA + build-security + bridge
npm run package                      # → out/HelloPear-<platform>-<arch>/
npm run test:worker                  # packaged production Bare worker
npm run test:peers                   # paired Bare peers, private loopback DHT
npm run test:desktop                 # packaged code + Electron UI smoke
npm run make                         # → installers in out/make/
```

`start`/`package`/`make` validate `package.json#upgrade`. The worker also parses
that link even with updates disabled. `UPGRADE_KEY` overrides the packaged value;
development reads the value on disk.

## Contracts: editing one side breaks the other, often silently

- Six-arg spawn argv order: `getWorker()` in `electron/main.js` ↔ the worker's positional reads
- Specifier `'/workers/main.js'`: renderer ↔ IPC channel names
- Pipe strings `updating`/`updated`/`pear:applyUpdate`/`pear:updateApplied`; FramedStream on both ends
- Node builtins used under `workers/` ↔ `package.json#imports`: Bare has no `events`,
  so in-project worker code needs a `{"bare": "bare-events", "default": "events"}`
  entry (hypercore and hyperswarm ship the same map). Dev silently resolves a hoisted
  npm shim, the packaged app prunes it — the worker then dies at boot with
  `MODULE_NOT_FOUND` and the UI shows nothing but a dead backend
- `productName` ↔ `AppxManifest.xml` Identity ↔ storage dirs
- `AppxManifest.xml` Publisher CN ↔ Windows signing cert (stable across builds)
- `pear.json#multisig`: **any edit = different production key**
- `package.json#version` ↔ generated package metadata (AppImage/Snap/MSIX/Flatpak) ↔ release metadata (metainfo.xml <release>, Flatpak URLs + sha512)

## Boundaries

You are a tool assisting the maintainer, not a substitute for them. Exceptions to
any rule here are the human's call: when a task seems to require one, stop and
surface the conflict instead of working around it. Exceptions are expected to be
rare.

- ✅ **Always:** if your change makes a _descriptive_ statement in AGENTS.md or
  `agent_docs/` false, update the doc and flag it in your summary; if it conflicts
  with a contract or boundary, stop and ask instead — never rewrite a rule to
  legalize your own change
- ✅ **Always:** check worker changes in a packaged build (`npm run package`) —
  Bare resolves modules differently there than in dev, so `npm start` passing
  proves nothing about the worker booting for a user. Work is done when lint
  passes and, for worker changes, the packaged app boots.
- ⚠️ **Ask first:** `pear.json`, `AppxManifest.xml` identity/publisher, new deps,
  electron bumps
- 🚫 **Never:** deployment and publishing (`pear stage`,
  `pear provision`, `pear multisig`, `pear seed`, pushing `v*` tags), unless
  the user explicitly asked for exactly that in
  this session
- 🚫 **Never:** enable asar (breaks worker spawning); add CLI flags/launch surfaces
  without declaring them to paparam in `electron/main.js` (unknown argv crashes the
  packaged app); commit secrets

## Topic docs — match your task, read the doc BEFORE editing that area

The `agent_docs/` files describe current runtime behavior, build configuration,
and cross-package contracts. Read the relevant topic before changing it:

- Editing `electron/`, `renderer/`, `workers/`, or debugging worker spawn/IPC/startup
  → [`agent_docs/architecture.md`](agent_docs/architecture.md)
- Touching the update flow or update UI, adding P2P data, or debugging missing
  updates → [`agent_docs/updates.md`](agent_docs/updates.md)
- Touching `forge.config.js`, `build/`, `flatpak/`, rebranding, or signing
  → [`agent_docs/packaging.md`](agent_docs/packaging.md)
