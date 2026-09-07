# Drive picker design screenshots

These screenshots render the actual `client.js` picker component with synthetic file names and the pinned DSH bundle’s native theme CSS. They show the desktop dark/light layouts, the selection review, and the narrow layout. They are PR design evidence, not screenshots of a deployed DSH profile or real Google Drive data.

With the repository's existing pinned Playwright and Chromium available, regenerate them from the repository root:

```sh
node packages/dsh-google-drive/test/capture-picker.mjs
```

The script overwrites the PNGs in this directory. It starts no web server, blocks network requests, and checks modal width, horizontal overflow, fixed-footer behavior, confirmation-button visibility, and primary-button text contrast (at least 4.5:1). It does not update the real-shell visual-test baselines.

- [Initial My Drive view](picker-empty.png)
- [Desktop, dark](picker-dark.png)
- [Desktop, light](picker-light.png)
- [Selection review](picker-selection.png)
- [Narrow layout](picker-mobile.png)
- [Landscape, scrolled selection review](picker-landscape.png)
