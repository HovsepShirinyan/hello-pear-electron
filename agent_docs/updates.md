# OTA and Autopass updates

> Read before editing the update flow/UI, worker P2P storage, or update handling.
> These notes describe the current runtime behavior and failure boundaries.
> Index: [AGENTS.md](../AGENTS.md).

## Download and readiness

- `npm start` passes `--no-updates`. Autopass remains active; the OTA flag only
  controls the updater's replication and apply path.
- The desktop broker enables OTA only for packaged non-MAS macOS apps, Linux
  AppImages outside Snap/Flatpak, and Windows MSIX apps. Unpacked Windows/Linux
  runs and development sessions cannot apply updates.
- With updates enabled, the worker replicates the updater Corestore over its
  swarm and joins the update drive as a client. It does not seed that drive.
- The updater checks at launch. Later drive appends use a randomized delay of up
  to one hour; appends within 60 seconds of boot check immediately. Only a higher
  semantic version is accepted.
- Raw `updating` and `updated` messages reach the renderer. The latter displays
  the apply button. `update-scheduled` and updater errors are forwarded as well.

## Apply and failure handling

- `pear:applyUpdate` targets `'/workers/main.js'`. Electron checks the platform
  gate before sending the raw command over the framed pipe.
- The worker rejects disabled updates, a missing installed-app path, an already
  attempted swap, or a missing downloaded bundle. Concurrent raw requests wait
  for the active operation's response rather than starting a second swap.
- Success produces `pear:updateApplied`; a caught failure produces
  `pear:updateFailed ...`. The renderer calls `app:afterUpdate` only after success.
  That handler relaunches macOS/Linux apps and quits; Windows update installation
  controls its restart behavior.
- Electron caches one promise per worker pipe, including its settled outcome.
  It rejects on explicit failure, worker exit/error, pipe error/close, or a
  120-second deadline. Temporary listeners and the timer are removed on settlement.
- The runtime sets its applied latch before replacing files. A failed or
  uncertain swap requires a fresh app/worker session before retrying. The renderer
  preserves failure feedback and disables the apply button. A timeout settles
  the caller but does not cancel a swap already in progress.

## Autopass and verification

- Autopass uses its own Corestore under `pear.storage/autopass` and manages its
  own replication. Its `entries:changed` notifications do not depend on OTA.
- The renderer refreshes entries from these notifications through the typed
  service; the updater's raw messages remain separate from entry JSON.
- OTA tests cover failures, safe apply gates, shared attempts, and cleanup without
  replacing installed files. A downloaded release, signed installer, successful
  file swap, and relaunch have not been verified end to end.
- The peer test verifies real pairing and replication between packaged Autopass
  instances on a loopback DHT. UI pairing and public-network traversal are not
  covered; the production worker/UI have separate smoke checks.
