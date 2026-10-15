# Exo Mouse

The mouse settings in Exo Launcher's Devices room: DPI, polling rate, lift-off,
buttons, lighting, profiles and the rest, for every mouse
[OpenMouse](https://github.com/OpenMouse-Project)'s protocol library supports.

Exo Mouse is a separate program from Exo Launcher. It is licensed under the
GNU Affero General Public License v3.0 or later (see `LICENSE`), because it is
built on [`@openmouse/protocol`](https://github.com/OpenMouse-Project/mouse-protocol),
which is. Exo Launcher itself is not covered by this license.

## How it fits

Exo Mouse runs in a frame inside Exo. It has no access to the system of its
own; it reaches devices only through a small message protocol with its host:

| Message | Meaning |
| --- | --- |
| `hid.list { vendorIds }` | Present HID devices: an opaque key, ids, product name, collections |
| `hid.open` / `hid.close { device }` | Open or close every collection of a device (shared, never exclusive); input reports flow while it is open |
| `hid.sendReport` / `hid.sendFeatureReport { device, reportId, data }` | Write a report (base64) |
| `hid.receiveFeatureReport` / `hid.receiveInputReport { device, reportId }` | Read a report (base64) |
| event `hid.input { device, reportId, data }` | An input report |
| event `hid.changed` | A device arrived or left |
| `exo.games` | Installed games, id and title only, to link a profile to games |
| `exo.profiles.read` / `exo.profiles.write { data }` | Exo Mouse's saved profiles, kept in Exo's data folder |
| one-way `{ notice }` / `{ state }` | A one-line notice for Exo to show, and the mouse's name and battery for its title bar |
| event `game.runState { id, isRunning }` | A game started or stopped |
| event `room.visible` | Whether the Devices room is on screen |

`src/exo-hid.ts` turns that into the browser's WebHID interface, so the
protocol library's drivers run unchanged.

## Fixes to OpenMouse

`scripts/patch-protocol.mjs` runs before every build and fixes `@openmouse/protocol`
0.42.2 where Exo Mouse needs it before upstream ships the fix. Today that is
reading the Finalmouse Starlight X's DPI and polling rate
([OpenMouse-Project/mouse-protocol#230](https://github.com/OpenMouse-Project/mouse-protocol/pull/230)).
The script stops the build when the library version changes, so a fixed release
is noticed and the patch removed.

## Build

```
npm ci
npm run build
```

Inside Exo Launcher's source tree it builds into Exo's web root
(`ExoLauncher/wwwroot/mouse`); on its own, into `dist/`. Exo Launcher's build
runs it with its own UI.
