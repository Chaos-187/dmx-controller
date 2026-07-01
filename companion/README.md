# companion-module-dmx-controller

Bitfocus Companion module for the Eyup Events DMX Controller.

## Build

```bash
npm install
npm run build
```

## Install in Companion

1. Build (`npm run build` in this folder)
2. Companion → **Settings** → **Developer modules path** → set to the **repo root**:

   `C:\source\Node\dmx-controller`

   **Not** this `companion` folder — Companion scans subfolders of the dev path.

3. Enable developer modules and restart Companion
4. **Import / Export** → import `config/dmx-controller-streamdeck15.companionconfig` (or `-xl`)
5. Remap the **DMX Controller** connection to your server IP

## Documentation

- [docs/companion.md](../docs/companion.md) — full setup guide
- [companion/HELP.md](./companion/HELP.md) — in-app help

## Import page layouts

Pre-built configs in [`config/`](./config/):

- `dmx-controller-streamdeck15.companionconfig` — 5×3 (15 keys per page)
- `dmx-controller-streamdeck-xl.companionconfig` — 8×4 (32 keys per page)

Pages: **Home**, **Fixtures**, **Scenes**, **Colors**, **Color FX**, **Cell FX**, **Mover FX**, **Rig FX**.

**Colors page:** each key has **Set Color (Press)** + **Release Color** (PUSH mode). Nav button switches **PUSH ↔ TOGGLE** — see [docs/companion.md](../docs/companion.md#color-buttons--push-vs-toggle).

Sub-pages include a **bottom nav row**: **HOME**, **STOP FX** (or color mode on Colors), shortcuts to other sections, **BLACKOUT**, **OUTPUT**.

Regenerate from your database (with MIDI default mappings for best results):

```bash
npm run companion:config
# from repo root, on the show PC
```
