# Sub2API Quota Widget

A local Sub2API account quota dashboard with a Windows desktop widget mode.

## Features

- Local web dashboard for adding, editing, deleting, and refreshing accounts.
- Desktop widget powered by Electron for always-visible quota display.
- Auto refresh every 60 seconds by default.
- Local-only storage in `data/accounts.json`.
- No telemetry, cloud sync, or bundled personal account data.

## Install

```powershell
npm.cmd install
```

## Start The Web Dashboard

```powershell
npm.cmd start
```

Open:

```text
http://127.0.0.1:3847/
```

## Start The Desktop Widget

```powershell
npm.cmd run desktop
```

Or run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-desktop.ps1
```

## Environment Variables

```text
HOST=127.0.0.1
PORT=3847
```

## Data And Privacy

- Account data is stored locally in `data/accounts.json`.
- `data/` is ignored by Git and should never be committed.
- Do not commit migration packages, desktop settings, logs, or `.env` files.
- API responses returned to the frontend mask access and refresh tokens, but the local data file still contains sensitive credentials.

## Project Structure

```text
desktop/   Electron desktop shell
public/    Frontend assets
server/    Local HTTP server and Sub2API request logic
scripts/   Windows helper scripts
assets/    Icon assets
```

## License

MIT
