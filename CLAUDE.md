# Pinehaven Golf

A browser 3D golf game. Sources live in `src/`; `python3 build.py` assembles
them into `Golf.html` (double-click to play, works offline) and
`dist/golf-artifact.html` (the claude.ai Artifact build). See README.md for
layout, controls and tests.

## Routine after every build

Whenever `python3 build.py` produces a new `Golf.html` that you are handing
over (a finished change, not an intermediate debug build):

1. Commit and push it with the source changes.
2. Send `Golf.html` to the user as a download with `SendUserFile`
   (`display: "attach"`), so they can grab the playable file right in the
   chat.
3. If the Artifact was published in this conversation, republish
   `dist/golf-artifact.html` to the same URL
   (https://claude.ai/artifact/NuGkUAPyjw2cTL9V8aZHLD).
4. Remind the user, in a line or two, of any items still open in
   `BACKLOG.md` (their list of things to add later), and tick off any the
   build just finished.

## Other writers on the default branch

The in-game Workshop commits models/textures to `assets/` on the default
branch, and the **Rebuild game** Action (`.github/workflows/build.yml`)
commits a rebuilt `Golf.html` after any change to sources or assets. So
before pushing: `git fetch` and rebase onto the remote branch. If `Golf.html`
or `dist/golf-artifact.html` conflict, don't merge them by hand: take either
side, run `python3 build.py`, and commit the result. The build must stay
deterministic (same inputs, byte-identical output), or the Action will
commit a rebuild after every push.

## Checks before handing over a build

- `node tests/course-check.js` and `node tests/calibrate.js` (fast, no browser)
- `node tests/smoke.js`, `node tests/workshop.js`, `node tests/publish.js`,
  `node tests/mobile.js`
  (headless Chromium with software GL: slow, so run them one at a time; when
  several run at once they starve each other and time out)
