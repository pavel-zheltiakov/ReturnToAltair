// main.js's toggleFullscreen(), unchanged — including the webkit spellings, which are what
// Safari still answers to.

export function toggle() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  } else {
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  }
}
