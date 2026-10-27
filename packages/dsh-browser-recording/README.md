# Browser recording

`@local/dsh-browser-recording` adds agent tools for user-requested browser interaction recordings in DSH `0.2.1-rc.3`. It does not record your desktop or DSH itself, attach to your personal browser, or install any software. The `personal-web` recipe selects it; applying the recipe or restarting a retained profile requires separate approval.

Ask your agent to record a short browser demo and supply the starting URL. It uses:

- **`browser_recording_start`** — open an isolated browser at an HTTP(S) URL and start a 1280 × 720, 2× recording with a visible pointer.
- **`browser_recording_action`** — hover, click, fill/type, press an allowed key, move to `x,y`, scroll, wait for a selector, or read an accessibility snapshot. Actions include real curved pointer travel and visible typing; neighboring controls can be toured before the target.
- **`browser_recording_stop`** — close the browser, compact idle gaps, and export a silent H.264 MP4. Compacted clips up to 30 seconds also produce an infinitely looping animated WebP. Longer clips return MP4 only, with `loopSkipped: true`.
- **`browser_recording_discard`** — close the browser and delete temporary media without exporting. Previously exported files are not deleted.

## Prerequisites and execution world

On the machine selected by DSH's **subprocess provider**, preinstall Node.js, `agent-browser` (verified with `0.38.1`), Chromium, `ffmpeg` with `libx264` and `libwebp_anim`, and `ffprobe`. A working browser installation is required; the plugin never downloads one. Linux is verified. macOS has path handling but has not been tested; Windows is not supported. Chromium can come from `~/.agent-browser/browsers/chrome-*/chrome` or the execution environment's absolute `AGENT_BROWSER_EXECUTABLE_PATH` (including a path containing spaces).

Before creating a recording directory or launching a browser, the runner encodes tiny synthetic frames to check FFmpeg's `-fps_mode vfr` support with `libx264` and its `libwebp_anim` encoder. An executable that only answers `-version` is not sufficient. If this check fails, ask the execution-environment operator to provide compatible FFmpeg on `PATH`; the plugin does not install tools or use a legacy compatibility mode.

The Host sends a self-contained checked runner through DSH's managed subprocess stdin. Browser state, media encoding and file operations happen in that execution world; no same-named Host path is assumed. A remote provider therefore needs its own binaries, browser installation, working-directory mapping and process-lifetime support. This release is verified with DSH's local subprocess provider, not a remote provider.

The recorder uses a unique session and private temporary directory, ignores inherited agent-browser profile/CDP/provider configuration, and enables desktop hover capability through a task-owned Chromium launcher. It does not restore credentials or browser state from another session. It records only one session per DSH Session; overlap and cross-session access are rejected. Plugin/agent disposal, invocation cancellation and a two-minute lifetime deadline attempt to close the browser and discard temporary media. After abrupt Host/machine termination, automatic cleanup cannot be guaranteed; recordings do not resume, and leftover `dsh-browser-recording-*` temporary directories may need manual review/removal.

## Safety and delivery

**Recording captures visible content without automatic redaction.** Do not use it for login, passwords, OTPs, API keys, payment details or personal data. Password and declared OTP/payment autofill fields reject tool-driven typing, but that is not a general secret detector. Arbitrary JavaScript, browser CLI commands, uploads, clipboard reads and credential imports are not exposed. Tool arguments and page snapshots may enter DSH's normal session history. Browser text is untrusted data. Recording authorization does not authorize purchases, posting, sending messages or other external writes; the agent must obtain the normal approvals.

Exports live under the session working directory at `.dsh/artifacts/browser-recordings/<id>/recording.mp4` and `recording.loop.webp`. Treat these as sensitive runtime artifacts and keep `.dsh/` out of Git. Temporary raw media is removed after successful export. An export failure retains the stopped recording for another stop/export attempt or discard. No action is retried automatically; a failed click may already have taken effect.

The agent should inspect the recording, deliver the MP4 with DSH's native `present` tool, and use an ordinary Markdown image pointing to the WebP to show the loop in **Web DSH**. Native image-attachment normalization can turn animation into a still image, so the plugin deliberately returns session-filesystem paths instead. DSH Desktop's `dsh-app:` page does not support the same inline local-image route; deliver/open the file externally there. File delivery is not a durable byte copy: moving a session to another machine requires moving its recordings too.

## Development and validation

The package reuses the existing pinned DSH packages and root compiler; no browser or encoder is bundled. Follow the repository's dependency approval procedure.

- `node packages/dsh-browser-recording/scripts/build-host.mjs` strictly checks TypeScript and regenerates the committed host and self-contained runner.
- `node --test packages/dsh-browser-recording/test/*.test.mjs` checks publication freshness, controlled action inputs, compaction, native Cordis/tool registration, owner isolation, overlap, cancellation and disposal. Native registries are real; subprocess results are controlled fixtures. Included in root `pnpm test`.
- `node packages/dsh-browser-recording/test/recording-journey.mjs` is an explicit opt-in check requiring the preinstalled browser/media tools. It mounts the real plugin and local managed subprocess provider, records a disposable loopback page with no credentials or external calls, checks the changed DOM through a native accessibility snapshot, rejects password-field typing, and verifies animated WebP plus 2560 × 1440 silent MP4 output. Set `DSH_RECORDING_EVIDENCE` to an output directory to retain reviewable media. No paid model, production website, live profile or dependency installation is used.

The pointer/action-interval/compaction workflow follows the recorder used in Amp's `using-agent-browser` skill. This package owns its implementation and does not rely on an Amp installation or a server-synced skill path at runtime.
