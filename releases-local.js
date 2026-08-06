// The release being prepared right now, shown on the Releases page before the GitHub
// release exists — it is created when the version tag is pushed. An entry whose tag is
// already on GitHub is ignored, so this never duplicates or overrides a published release.
//
// Generated from RELEASE_NOTES.md by tools/release-feed.py. Edit the notes, not this file.
window.LOCAL_RELEASES = [{
  "tag_name": "v0.1.0-alpha.1",
  "name": "Return to Altair 0.1.0-alpha.1",
  "published_at": "2026-08-06T00:00:00Z",
  "html_url": "https://github.com/pavel-zheltiakov/ReturnToAltair/releases",
  "prerelease": true,
  "body": "The first public build, and an early access one: playable end to end, native on macOS\ntoday, and still moving.\n\n## The game\n\n- **A generated sky** — systems, economies and governments come out of a seed, not a level editor.\n- **Trade** — buy low, jump, sell high, and carry what the local law does not allow.\n- **Flight and combat** — torus drive, mass-lock, and pirates that spawn by government type.\n- **Dock by hand** — match the Coriolis's spin and fly the slot, or buy the computer.\n- **Procedural worlds** — terrain, ice caps and cloud, all from the system's own seed.\n- **Generated sound** — every effect and all three ambient beds are oscillators; no audio files.\n- **Local saves** — docking autosaves into its own slot, and never overwrites yours.\n\n## Running it\n\n- **macOS** — one universal bundle, Apple ARM and Intel in the same file. It is signed but\n  not notarized yet, so macOS stops the first launch: open System Settings → Privacy &\n  Security, and press Open Anyway. After that it starts like anything else.\n- **No runtime** — it is a single compiled executable. Nothing to install alongside it.\n- **Windows and Linux** — the same game, built from the same source, but not in this\n  release: each is compiled on its own machine and that has not run yet.\n- **In a browser** — not yet either. It builds and it runs, but it does not start reliably\n  in a tab, and shipping it before it does would waste your time rather than save it.\n\n## Known limits\n\n- **Early access** — anything here can be different in the next build.\n- **Not in yet** — missions, missiles and ECM in flight; front view only.\n- **Simplified** — docking approach and pirate AI.\n- **One look** — the 1984 wireframe and flat-shaded modes are planned, not here."
}];
