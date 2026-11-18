# NEON TIDE: Port Solano — build status

Entry for the make.fun bounty "Make GTA 6" (`gta6-01`). An original open-world crime game in
three.js: own city (Port Solano), own characters (Mara Quill, Benny Okafor, the Tidewater crew,
the PSPD), own vehicles (Kestrel GT, Marlin, Dromo, Bruin, Solano Cab, PSPD Cruiser). No build
step, no network requests, no image or audio files: every texture and sound is generated in code.

## Features

- **City**: 8x8 blocks on a road grid with a seaside boulevard, promenade, beach, ocean, pier and
  Ferris wheel. Four districts (Marea Beach, Old Solano, Downtown, The Docks), a park, Benny's
  Garage, the Tidewater hideout, a PSPD precinct and a clinic. Lit-window facades, neon signs,
  palms, streetlights, golden-hour sky with fog, sun shadows and sky reflections.
- **On foot**: walk and run relative to a mouse-orbit follow camera, collide with buildings and cars.
- **Vehicles**: six models, arcade physics with grip, drift, handbrake, damage, smoke and
  explosions. Any parked or traffic car can be stolen with E; drivers are thrown out.
- **Traffic**: about 24 AI cars keep lanes, turn at junctions, brake for obstacles, panic at
  gunfire; roughly 120 parked cars line the kerbs.
- **Pedestrians**: about 34 walk the sidewalks and promenade, cross roads, flee, get knocked down,
  drop cash.
- **Wanted system**: 1 to 5 stars from witnessed car theft, ramming, hitting or killing people,
  gunfire and attacking police. Cruisers spawn, pursue on the road grid, box the player in, ram,
  shoot at 3+ stars, and officers step out on foot. Stars decay out of sight. Busted and wiped-out
  states respawn at the precinct or the clinic with a fee.
- **Combat**: fists and a mouse-aimed pistol with glowing tracers and muzzle flash; police rounds
  that land throw sparks; ammo, health, armor and cash pickups.
- **Missions**: story intro card, then "First Score" (steal the marked Kestrel GT, deliver it to
  Benny's Garage in 120 s, $750 plus a $250 clean-delivery bonus) and "Heat Escape" (reach 3
  stars, get to the hideout, lay low, $1,500). Banners, objective line, 3D beacon, replayable.
- **HUD**: money, wanted stars, weapon and ammo, health and armor bars, mission title and timer,
  objective with distance, speedometer and car health, enter/steal prompt, event feed, and a
  minimap (roads, blocks, sea, player arrow, traffic, police blips, pickups, landmarks, objective
  marker with a GPS route line, street and district name).
- **Menus**: title screen (New Game, Continue, controls), story card, pause menu (resume, sound,
  save and quit). Money and mission progress save to localStorage; a mission payout shows
  "Game saved" in the feed when the write succeeds.
- **Sound**: WebAudio synth for engine, siren, gunshot, crash, pickup, mission sting; M mutes.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk; drive and steer |
| Mouse | Look and aim (click the game to capture the mouse; right-drag also turns the camera) |
| Shift | Run |
| E | Enter, steal or exit a car |
| Click / F | Punch or fire |
| Q (or 1 / 2) | Switch fists / pistol |
| Space | Handbrake |
| H | Horn |
| P / Esc | Pause |
| M | Mute |

## Screenshots

Staged by `game/src/shots.js` behind `?shot=<name>&seed=1`, captured at 1280x720 through the
Playwright MCP after `window.__shotReady`, JPEG quality 80. Captured after the last change to
game code (fix round).

| File | Scene | Bytes |
| --- | --- | --- |
| `screenshots/1-cover.jpg` | `?shot=cover`: Mara at the driver's door of the pink Kestrel GT on Marea Blvd, the game's "E Steal Kestrel GT" prompt up, 1 star, a PSPD cruiser closing in through traffic | 154,003 |
| `screenshots/2-drive.jpg` | `?shot=drive`: chase cam at 86 mph down Sunset Strip, First Score timer running | 183,646 |
| `screenshots/3-wanted.jpg` | `?shot=wanted`: 4 stars, a PSPD officer on foot firing on the Kestrel beside his cruiser, two more cruisers coming off the boulevard, Ferris wheel behind | 138,162 |
| `screenshots/4-mission.jpg` | `?shot=mission`: MISSION COMPLETE at Benny's Garage, marker cleared, money up to $2,250, "Game saved" in the feed | 150,467 |

All four are under the 262,144-byte cap. `game/` holds 25 files, 942,294 bytes (caps: 993 files, 48 MiB).

## Fix round (after the independent review)

A review of commit `59c5a7f` asked for four changes to what the screenshots show. All four frames
were recaptured from the final code in this round.

1. **Cover shows the theft interaction.** `stageCover` now puts Mara at the Kestrel's driver door,
   1.7 m from the car's centre (reach is 3.4 m), so the HUD raises its own "E Steal Kestrel GT"
   prompt: `shots.js` never writes that text. Her whole figure is in frame above the prompt, the
   cruiser and taxi are in the street behind her, and the objective diamond and the wanted line sit
   clear of the KARAOKE and LUCKY 9 signs. The one-star wanted level is set by the staging, as before.
2. **Wanted shot shows police gunfire.** The scene is rebuilt around an officer on foot. The staging
   stops a cruiser in its box-in slot behind Mara on foot and runs the simulation until `police.js`
   itself sends the officer out; it then seats her in the Kestrel, places two more cruisers, and
   freezes on the officer's next shot. That shot (aim pose, muzzle flash, tracer, hit roll) is fired
   by `police.js`. Two things are set by the staging and not by play: positions and speeds of the
   cars, and the officer's fire timer, which is brought forward so the shot lands in the frame.
   The old staging drew tracers and sparks from `shots.js`; that code is gone. With seed 1 the
   game's 35% roll makes this shot a hit: six impact sparks spawn on the car, but they are small
   and hard to see in the frame, so the readable evidence is the flash and the tracer.
   To make gunfire readable at small sizes the game itself changed: tracers are glowing bars
   instead of 1 px lines, the muzzle flash is larger, and a police round that lands throws sparks.
3. **Mission shot shows the real completed state.** `stageMission` now calls the game's own
   `completeMission` and no longer restores the delivery marker, so there is no beacon over the
   garage sign and no route on the minimap. Two feed lines were added to the game and appear here:
   "+$1,000 First Score paid" (HUD, on mission completion) and "Game saved 1 of 2 jobs done"
   (`main.js`, shown only when the write to localStorage succeeded).
4. **Mara's silhouette.** `characters.js` gives her a high pink ponytail (knot and tapering tail)
   and wears her teal jacket open over the white shirt with a turned-up collar and a pink hem. The
   cover turns her about three-quarters toward the lens. Pedestrians and officers are unchanged.

`2-drive.jpg` keeps its staging; it was recaptured because the character and effects code changed.

## Verification

Re-run in the fix round on the final code, results read:

| Check | Result |
| --- | --- |
| `node --check` on every `game/src/*.js` | exit 0 |
| `node serve.ts`, load `/` in Chrome via Playwright | boots; 0 console errors, 0 warnings |
| All four `?shot=` scenes reach `__shotReady` | yes; 0 console errors, 0 warnings, no request outside `http://localhost:8080/` |
| Cover scene state | prompt element reads "E Steal Kestrel GT"; player 1.7 m from the car |
| Wanted scene state | 4 stars, one officer on foot deployed by `police.js`, his shot fired by `police.js` |
| Mission scene state | phase `complete`, `world.marker` null, banner and both feed lines present |
| Play-test (keyboard): New Game, story card, walk, switch to pistol, fire | moved 1.7 m, ammo 24 to 23, wanted rose to 2 stars, 0 console errors |
| Title screen after the mission scene ran | Continue offered the save it wrote ($2,250, 1 of 2 jobs) |
| `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` | exit 0; `out/dossier.json` written; `out/game` and `out/screenshots` identical to the sources |
| Dossier outline | same 17 file sections in the same order as before, gameplay files first |
| `node cli/makefun.mjs check --kit . --repo <this repo>` from the kit dir | exit 0: 4 passed, 0 failed, 16 skipped (site-side transcript checks), 5 checked at submission |
| `vendor/makefun-game.ts`, `main.ts`, `serve.ts` | unchanged in the fix round |

From the first build, not repeated in the fix round:

| Check | Result |
| --- | --- |
| Play-test driving | stole a parked Marlin with E, reached 41 mph, witnessed theft gave 1 star |
| Mission "First Score" start to finish | start marker, steal, 120 s timer, delivery: $250 to $1,250, saved, next job offered |
| Mission "Heat Escape" start to finish | 3 stars by gunfire, hideout, 5 s lay-low: $1,250 to $2,750, stars cleared, saved |
| Police at 4 to 5 stars | five cruisers spawned and converged; player wiped out, respawned at the clinic, heat cleared |
| Busted | 2 stars on foot: arrested, released at the precinct, $150 fee, stars cleared |
| Pause | P froze simulation time; Enter on the focused Resume button resumed |
| Frame rate at 1280x720 on this machine | 60 to 61 fps in play; about 300 draw calls, 210k triangles |
| `.makefun/owner.json`, `LICENSE` vs the starter commit | unchanged |

## Not verified, and known limits

- Sound was not listened to: the synth code runs without errors, but nobody heard it.
- Missions were play-tested with keyboard and mouse input for the real interactions (entering
  cars, driving the last metres, firing), but the long drives between places were skipped by
  moving the player or car with a script.
- Pointer lock was not exercised (automation cannot grant it); right-drag camera is the fallback.
- The fix round did not replay the two missions end to end or re-measure frame rate; the new
  feed lines and impact sparks were seen through the staged scenes and a short play-test only.
- The dossier text is capped at 160 KiB, so 6 of the 24 source files (city, sky, pickups, audio,
  shots, CSS) and the tail of `police.js` are not shown to the judge. Imports are ordered so
  gameplay files come first.
- The transcript gate, repository visibility and ownership are checked by the site at submission.
- Police cruisers do not avoid civilian traffic; traffic ignores pedestrians on the road.
