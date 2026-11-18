// NEON TIDE: Port Solano is our gta6-01 entry, an original open-world crime game built on
// three.js, and this program hands it in (Node 22, standard library only).
// The game is the static game/ folder beside this file. You play Mara Quill, a getaway driver
// back in the sunset harbor city of Port Solano: 8x8 blocks to roam on foot or in any car you
// can steal, traffic circulating the grid, pedestrians on the sidewalks, a five-star wanted
// system with police who chase and box you in, fists and a pistol, two story missions for the
// Tidewater crew, a HUD with a live minimap, a title screen with save and continue, and a tiny
// WebAudio synth. It runs offline: three.js is vendored as game/vendor/three.module.min.js and
// the game makes no network request.
//
// What this file does: copies game/ and screenshots/ to /output and writes /output/dossier.json,
// the summary the judge reads, using the vendored make.fun library.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
