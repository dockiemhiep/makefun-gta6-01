// menus.js: the full-screen menus over the live city. The title screen (New Game, Continue,
// controls list), the story intro card that sets up the missions, and the pause menu.
const CONTROLS = [
  ['W A S D', 'Walk / drive and steer'],
  ['Mouse', 'Look and aim'],
  ['Shift', 'Run'],
  ['E', 'Enter, steal or exit a car'],
  ['Click / F', 'Punch or fire'],
  ['Q', 'Switch fists / pistol'],
  ['Space', 'Handbrake'],
  ['H', 'Horn'],
  ['P / Esc', 'Pause'],
  ['M', 'Mute sound'],
];
const root = () => document.getElementById('screens');
let keyHandler = null;

function controlsMarkup(heading = 'Controls') {
  const rows = CONTROLS.map(([key, what]) => `<dt>${key}</dt><dd>${what}</dd>`).join('');
  return `<div class="controls-card"><h2>${heading}</h2><dl>${rows}</dl></div>`;
}

function mountScreen(markup, onKey) {
  closeScreens();
  root().innerHTML = markup;
  if (onKey) {
    keyHandler = onKey;
    window.addEventListener('keydown', keyHandler);
  }
  const first = root().querySelector('button:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
}

/** Remove whichever menu is open. */
export function closeScreens() {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  root().innerHTML = '';
}
export const isScreenOpen = () => root().childElementCount > 0;

/** Title screen. saved is null or { money, missionsDone } and enables Continue. */
export function showTitleScreen({ saved, onNewGame, onContinue }) {
  const progress = saved ? `$${saved.money.toLocaleString('en-US')} · ${saved.missionsDone.length} of 2 jobs done` : 'No saved game yet';
  mountScreen(`
    <section class="screen screen-title" aria-label="Title screen">
      <div class="title-left">
        <h1 class="logo"><span class="logo-main">Neon<br>Tide</span><span class="logo-sub">Port Solano</span></h1>
        <p class="tagline">Steal the car. Outrun the PSPD. Own the sunset.</p>
        <nav class="menu" aria-label="Main menu">
          <button type="button" class="primary" data-action="new">New Game<small>Start Mara's story from the top</small></button>
          <button type="button" data-action="continue" ${saved ? '' : 'disabled'}>Continue<small>${progress}</small></button>
        </nav>
      </div>
      <div class="title-right">
        ${controlsMarkup()}
        <p class="footnote">An original open-world crime game. Progress saves in this browser.</p>
      </div>
    </section>`);
  root().querySelector('[data-action="new"]').addEventListener('click', onNewGame);
  root().querySelector('[data-action="continue"]').addEventListener('click', () => saved && onContinue());
}

/** The story intro card shown before play begins. intro = { title, lines, signoff }. */
export function showStoryCard(intro, onBegin) {
  const lines = intro.lines.map((line) => `<p>${line}</p>`).join('');
  mountScreen(`
    <section class="screen screen-card" aria-label="Story">
      <div class="card">
        <h2>${intro.title}</h2>
        ${lines}
        <p class="signoff">${intro.signoff}</p>
        <nav class="menu"><button type="button" class="primary" data-action="begin">Hit the street</button></nav>
      </div>
    </section>`, (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); onBegin(); } });
  root().querySelector('[data-action="begin"]').addEventListener('click', onBegin);
}

/** Pause menu with resume, mute and quit-to-title. */
export function showPauseMenu({ muted, onResume, onToggleMute, onQuit }) {
  mountScreen(`
    <section class="screen screen-card" aria-label="Paused">
      <div class="card">
        <h2>Paused</h2>
        <nav class="menu">
          <button type="button" class="primary" data-action="resume">Resume</button>
          <button type="button" data-action="mute">${muted ? 'Sound: off' : 'Sound: on'}</button>
          <button type="button" data-action="quit">Save and quit to title</button>
        </nav>
        ${controlsMarkup()}
      </div>
    </section>`);
  root().querySelector('[data-action="resume"]').addEventListener('click', onResume);
  root().querySelector('[data-action="quit"]').addEventListener('click', onQuit);
  const mute = root().querySelector('[data-action="mute"]');
  mute.addEventListener('click', () => { mute.textContent = onToggleMute() ? 'Sound: off' : 'Sound: on'; });
}
