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

## Checks before handing over a build

- `node tests/course-check.js` and `node tests/calibrate.js` (fast, no browser)
- `node tests/smoke.js`, `node tests/workshop.js`, `node tests/mobile.js`
  (headless Chromium with software GL: slow, so run them one at a time; when
  several run at once they starve each other and time out)
