# Apex Config Editor

I play Apex on PC and got tired of digging through `settings.cfg` by hand every time I wanted to change a bind or fix my jump key. So I built a small Windows app that opens the game's config files, shows the settings in a normal UI, and saves only what you actually changed.

It's an Electron app, plain HTML/CSS/JS, no framework.

## What it does

- Reads your real Apex files: `settings.cfg`, `videoconfig.txt` and `profile.cfg` (it finds them in Saved Games on its own, or you can paste the path).
- Groups things into tabs: graphics & video, mouse & keyboard binds, controller, audio, launch options, plus an "all settings" table for everything else.
- The thing I built it for: the **jump / dash fix**. Space does `+jump;+dodge`, the scroll wheel only does `+jump`, so jetpacks, Octane pads, double jumps and mantle boosts only fire from Space and not when you bhop with the wheel.
- Shows you exactly what will change before saving (old value → new value).
- Makes a backup every time it saves. The very first one is kept as `ORIGINAL` and never deleted, and there's a button to put everything back.
- Can set the files to read-only after saving so the game doesn't overwrite them.
- Copies your launch options (skip intro, FPS cap, etc.) or writes them straight into Steam. That last one is experimental, so close Steam first. The app can do that for you.

Every line the app doesn't touch is written back exactly as it was. That's the part I cared most about, and it's what the tests check.

## Running it

You need Node.js.

```
npm install
npm run start:d
npm test
```

To build a portable `.exe` (no installer, just double-click):

```
npm run dist
```

It ends up in `dist/`. The packaged app keeps its own settings in `%APPDATA%\Apex Config Editor`.

## How it's put together

```
shared/              the Node side: parser, file reading/saving, backups, Steam, the IPC bridge
versions/d-guided/   the app you actually use (UI + catalogs of settings)
versions/a, b, c     the first three prototypes I made before picking a direction
test/                node:test, runs against temp files, never your real ones
```

The page never touches the disk directly. `contextIsolation` is on, `nodeIntegration` is off, and everything goes through `preload.js` → IPC → `config-service.js`.

## Heads up

- Windows only.
- Not affiliated with EA or Respawn. It only edits your own config files, nothing in the game itself, but keep the backups around anyway.
- A few things aren't confirmed in game yet (some controller menu values, and whether an empty bind counts as unbound). The app marks those with a "?".
