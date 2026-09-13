# Serato DJ Pro integration (beta)

Uses **[serato-connect](https://github.com/chrisle/serato-connect)** (`npm` dependency) on the Thaluxis hub.

## Serato Remote (iOS) vs Thaluxis

Serato’s **Serato Remote** and **Remote Mini** **iOS apps** are discontinued and no longer sold. Serato documented support only up to certain old combinations (e.g. iOS 14 with Serato DJ Pro 3.1.3).

**Thaluxis does not use those apps.** The hub implements the same **OSC-over-TCP “Remote” protocol** on your LAN (via `SeratoRemoteClient` in serato-connect): the **desktop** Serato DJ Pro instance connects **to the hub** for live playhead, BPM, faders, and paths — similar to how the old iPad app paired.

Whether **your** Serato DJ Pro build still offers Remote pairing is up to Serato’s desktop product; newer versions may remove or hide it. If Remote never connects, use **History polling** (below) and/or stay on a DJ Pro version that still pairs with third-party Remote peers.

## Modes

| Mode | Config | Purpose |
|------|--------|---------|
| **Live OSC link** | `serato_remote_enabled=1` (default) | Hub advertises on mDNS; **Serato DJ Pro connects inbound** for playhead, BPM, faders, track paths |
| **History polling** | `serato_history_poll=1` (default) | Watches Serato 3 (`_Serato_/History`) or Serato 4 (SQLite) for deck/track changes **without** Remote |

Both can run together. When Remote is paired, playhead and beat sync are best. History alone gives track loads (typically ~2s poll); the hub can still run sequences once a track is loaded.

## Enable on the hub

1. Config → **DJ Software** → **Serato DJ Pro (Beta)**
2. Check **Enable Serato** (+ **Live OSC link** / **History polling** as needed)
3. **Save** → **restart** the hub
4. OS2L is disabled while Serato is the active provider

## Live OSC (legacy Remote protocol)

1. After hub boot, check the console for `[Serato] Remote server ready on port …`
2. In **Serato DJ Pro** (desktop), enable **Remote** / connect to the advertised hub on the same LAN (e.g. **Thaluxis-Hub**)
3. When paired: `[Serato] Remote peer connected from …`

**Startup order:** Serato typically **browses for Remote peers when DJ Pro launches**. If Serato was already running before the hub, it may not connect until you:

- Start the hub first, then launch Serato (easiest), or
- Use **Config → DJ Software → Re-advertise on network** (hub bounces mDNS every ~20s until paired), or
- Toggle **Remote** off/on in Serato, or restart Serato DJ Pro.

Exact menu names vary by Serato version. See serato-connect `docs/protocol.md` in the package repo.

If pairing is not available in your Serato version, disable **Live OSC link** and rely on **History polling**.

## Config keys

| Key | Default | Notes |
|-----|---------|--------|
| `dj_active_provider` | `virtualdj` | Set to `serato` |
| `serato_integration_enabled` | `0` | Master enable |
| `serato_remote_enabled` | `1` | Live OSC server |
| `serato_history_poll` | `1` | History monitor |
| `serato_library_path` | empty | Optional override for `_Serato_` / library folder |
| `serato_remote_port` | `0` | OS-assigned if 0 |
| `serato_peer_name` | `Thaluxis-Hub` | mDNS instance name |

## Deck data → Thaluxis

Same pipeline as VirtualDJ OS2L: filepath, play, BPM, beat position (from playhead when OSC is active), fader level, crossfader.

## Limitations (beta)

- No OS2L-style subscription/button map editor
- Library import into Thaluxis SQLite not wired yet (history gives paths only)
- Live OSC depends on Serato DJ Pro still supporting Remote pairing on your version
- Remote protocol deck indexing may need tuning on real hardware
- Requires Serato on **Windows or macOS**; hub is typically on the same machine or LAN

## Code

- `lib/serato-dj-runtime.js`
- `lib/dj-providers/serato-beta.js`
