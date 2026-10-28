# Watchtower

Windows desktop app that marks taskbar apps confidential so screenshot tools like Tivazo see what is behind them — not a black box.

## Install

Download the latest **Watchtower-*-x64.exe** installer from [Releases](https://github.com/abhinavsilwal247/watchtowerfull_new_hiding/releases).

Unlock PIN: `8998` (override with env `WATCHTOWER_PIN`).

Installed builds check GitHub Releases for updates on launch and every few hours.

## Develop

```bash
npm install --legacy-peer-deps
npm run app
```

## Ship an update

Every push to `main` builds a Windows installer and publishes a GitHub Release. Installed apps update automatically.

```bash
git add -A
git commit -m "your change"
git push origin main
```

Or bump manually:

```bash
npm run ship
```

## First release

Package version is **1.0.0**. Tag and push:

```bash
git tag v1.0.0
git push origin main --follow-tags
```
