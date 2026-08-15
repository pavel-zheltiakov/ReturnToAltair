import { dotnet } from './_framework/dotnet.js'

// M0 measurement: how long from first byte of script to the app taking over the page.
// Reported to the console so the number in docs/migration-plan.md is measured, not guessed.
const t0 = performance.now();

// The LOADING placeholder covers the whole of #out, so it has to go the moment the app puts
// its canvas there — otherwise a perfectly healthy game renders behind a black rectangle and
// looks exactly like a runtime that failed to start. Which is what it looked like at M0.
const out = document.getElementById("out");
const boot = document.getElementById("boot");
if (out && boot) {
  new MutationObserver((_, observer) => {
    if (out.children.length <= 1) return;
    boot.remove();
    observer.disconnect();
    console.log(`app on screen in ${Math.round(performance.now() - t0)} ms`);
  }).observe(out, { childList: true });
}

const runtime = await dotnet
  .withDiagnosticTracing(false)
  .withApplicationArgumentsFromQuery()
  .create();

const config = runtime.getConfig();
console.log(`runtime ready in ${Math.round(performance.now() - t0)} ms`);

await runtime.runMain(config.mainAssemblyName, [globalThis.location.href]);
