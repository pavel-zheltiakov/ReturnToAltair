// The release being prepared right now, shown on the Releases page before the GitHub
// release exists — it is created when the version tag is pushed. An entry whose tag is
// already on GitHub is ignored, so this never duplicates or overrides a published release.
//
// Generated from RELEASE_NOTES.md by tools/release-feed.py. Edit the notes, not this file.
window.LOCAL_RELEASES = [{
  "tag_name": "v0.1.0-alpha.3",
  "name": "Return to Altair 0.1.0-alpha.3",
  "published_at": "2026-08-10T00:00:00Z",
  "html_url": "https://github.com/pavel-zheltiakov/ReturnToAltair/releases",
  "prerelease": true,
  "body": "The third early access build.\n\n## Fixed\n\n- **Sound on Windows and Linux.** There was none: music, effects and the radio played on\n  macOS only. They play everywhere now.\n- **Launching and hyperspace no longer freeze.** Leaving a station or arriving from a jump\n  stopped the picture for several seconds. It does not any more.\n\n## Running it\n\n- **Windows** — a portable folder, no installer. SmartScreen may warn until the download\n  builds a reputation.\n- **Linux** — one AppImage. `chmod +x` it and run it.\n- **macOS** — one universal bundle. Not notarized yet, so the first launch is stopped: open\n  System Settings → Privacy & Security and press Open Anyway.\n- **In a browser** — no download, no install.\n\nEarly access: anything here can be different in the next build."
}];
