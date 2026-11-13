# Local packaging

> Read before changing `forge.config.js`, `build/`, or `flatpak/`. Index:
> [AGENTS.md](../AGENTS.md).

- Use npm. `npm run package` creates the local app in
  `out/HelloPear-<platform>-<arch>/`; `npm run make` creates local installers in
  `out/make/`.
- **Keep `asar: false`.** The external Bare worker needs real file paths.
- Forge's `generateAssets` hook builds the Vite renderer into `dist/renderer` for
  start/package/make, including direct Forge commands. Electron loads that HTML;
  `PEAR_DEV_SERVER_URL` selects the development server instead. Source TSX needs
  Vite processing.
- The `readPackageJson` hook checks the public upgrade key for start and packaging.
  `UPGRADE_KEY` overrides it for the packaged copy; development reads the on-disk
  `package.json`.
- Packaging prunes development dependencies. The prebuild plugins select native
  dependencies for the target platform. Worker imports must resolve under Bare
  from the packaged app, including any builtin mappings in `package.json#imports`.
  Verify worker changes by booting that app and running `npm run test:worker`.
- `npm run test:desktop` checks the packaged renderer and preload bridge.
  `flatpak/*.yml` remain local packaging inputs.
- The optional macOS `appdmg` chain retains an `image-size` ICNS-parser advisory.
  Forge uses the installer's bundled PNG background and checks its PNG signature
  before parsing. This limits the current input path; it does not remove the
  underlying advisory or validate every PNG.
