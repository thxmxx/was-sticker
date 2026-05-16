# Sandbox

Scratch area for manual / ad-hoc testing. **Contents are gitignored** — drop whatever you need here without polluting the repo.

Typical uses:

- Real PNG/JPG/WebP images to feed into `buildLottieSticker`
- Custom Lottie templates you're experimenting with
- Generated `.was` files to verify visually in WhatsApp

## Quick run

From the repo root:

```bash
node examples/build.js                                  # uses the bundled pulse template
./src/cli.js -i test/sandbox/face.png \
             -t test/sandbox/my-template \
             -o test/sandbox/out.was
```

Only this `README.md` and `.gitkeep` are tracked — everything else stays local.
