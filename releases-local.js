// The release being prepared right now, shown on the Releases page before the GitHub
// release exists — it is created when the version tag is pushed. An entry whose tag is
// already on GitHub is ignored, so this never duplicates or overrides a published release.
//
// Generated from RELEASE_NOTES.md by tools/release-feed.py. Edit the notes, not this file.
window.LOCAL_RELEASES = [{
  "tag_name": "v0.1.0-alpha.4",
  "name": "Return to Altair 0.1.0-alpha.4",
  "published_at": "2026-08-14T00:00:00Z",
  "html_url": "https://github.com/pavel-zheltiakov/ReturnToAltair/releases",
  "prerelease": true,
  "body": "The fourth early access build.\n\n## New\n\n- **The fleet is remastered.** Every ship has been modelled again — solid hulls with\n  panelling, fittings and a livery, in place of the old outlines. They are renamed with it.\n- **Better lasers, better wrecks.** Gunfire reads as a beam that arrives somewhere, and a\n  ship that dies comes apart and burns instead of blinking out.\n\n## Fixed\n\n- **Sound and the radio no longer freeze.** Both could stall mid-flight and take the\n  picture with them. They do not any more.\n\n## Running it\n\n- **Windows** — a portable folder, no installer. SmartScreen may warn until the download\n  builds a reputation.\n- **Linux** — one AppImage. `chmod +x` it and run it.\n- **macOS** — one universal bundle. Not notarized yet, so the first launch is stopped: open\n  System Settings → Privacy & Security and press Open Anyway.\n- **In a browser** — no download, no install.\n\nEarly access: anything here can be different in the next build."
}];
