// The browser head's save storage, reached from C# through [JSImport].
//
// This is web/js/state.js's storage half, unchanged in behaviour: probe localStorage on every
// access because Safari in private mode used to throw on access and not just on write, and let
// the caller fall back to memory when it does — a blocked-storage browser can still play, it
// just cannot persist.

function storage() {
  try {
    const s = globalThis.localStorage;
    const probe = "elitequest.probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function available() {
  return storage() !== null;
}

export function read(key) {
  const s = storage();
  return s ? s.getItem(key) : null;
}

export function write(key, value) {
  const s = storage();
  if (s) s.setItem(key, value);
}

export function keys() {
  const s = storage();
  return s ? Object.keys(s) : [];
}
