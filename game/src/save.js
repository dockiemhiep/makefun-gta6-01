// save.js: a small localStorage save of Mara's cash and which story jobs are done.
// Storage may be missing or locked (private mode, file://), so every call is guarded and never throws.
// The lead decides when to save; missions.js only reports progress through events.

const SAVE_KEY = 'neontide.save.v1';

function storage(capture = false) {
  try {
    return globalThis[capture ? 'sessionStorage' : 'localStorage'] ?? null;
  } catch {
    return null;
  }
}

/** True when a readable, valid save exists. */
export function hasSavedGame() {
  return loadSavedGame() !== null;
}

/** The saved { money, missionsDone, savedAt }, or null when there is none or it is malformed. */
export function loadSavedGame() {
  try {
    const raw = storage()?.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const money = Number.isFinite(data.money) ? Math.max(0, Math.round(data.money)) : 0;
    const missionsDone = Array.isArray(data.missionsDone)
      ? [...new Set(data.missionsDone.filter((id) => typeof id === 'string' && id.length > 0 && id.length < 40))]
      : [];
    const savedAt = Number.isFinite(data.savedAt) ? data.savedAt : 0;
    return { money, missionsDone, savedAt };
  } catch {
    return null;
  }
}

/** Store cash and completed jobs. Screenshot saves last only for the capture tab. */
export function writeSavedGame({ money = 0, missionsDone = [] } = {}, { capture = false } = {}) {
  try {
    const store = storage(capture);
    if (!store) return false;
    const record = {
      money: Number.isFinite(money) ? Math.max(0, Math.round(money)) : 0,
      missionsDone: Array.isArray(missionsDone) ? [...new Set(missionsDone.filter((id) => typeof id === 'string'))] : [],
      savedAt: Date.now(),
    };
    store.setItem(SAVE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Forget the save (new game). */
export function clearSavedGame() {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    // nothing to clear
  }
}
