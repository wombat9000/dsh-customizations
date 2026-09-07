# Local PDF extraction and OCR runtime

Google Drive PDF reads use administrator-installed Poppler utilities and Tesseract for optical character recognition (OCR). Processing runs locally on the machine that runs the DSH Host, not in the browser. The plugin does not install software or download language models when it loads or reads a file. It does not send PDFs to a cloud OCR service. Downloading the selected PDF still uses Google Drive.

**These native processes are resource-limited, not security-sandboxed.** They run with the DSH Host user's operating-system permissions. A native parser vulnerability can expose files or other resources available to that user. The macOS runner does not enforce a hard memory limit. Keep packages updated and use a separately constrained local VM or container if your threat model requires filesystem, network, or aggregate memory isolation. This plugin does not configure that isolation.

## Supported platforms and executable discovery

Linux and macOS are supported by the runner. Windows is not supported. Linux test results do not establish that native extraction works on a particular macOS deployment.

The runner searches these directories in order, without using inherited `PATH`:

1. `/usr/bin`
2. `/usr/local/bin`
3. `/opt/homebrew/bin`

It requires `pdfinfo`, `pdftotext`, `pdftoppm`, and `tesseract`, plus `prlimit` on Linux or `python3` on macOS. All binaries are required even when `ocr` is `off`. For macOS Python only, discovery checks `/opt/homebrew/bin` then `/usr/local/bin`; it excludes `/usr/bin/python3` to avoid invoking the developer-tools installation shim.

Resolved executable paths must remain under `/usr/` or `/opt/homebrew/`. The executable and its resolved parent directories must belong to root or the current user and must not be world-writable. Group write is rejected except for macOS's administrator group (GID 80), which supports standard Homebrew installations. These checks reduce accidental executable substitution; they are not signature verification or protection against a compromised current-user or administrator account.

Custom prefixes, MacPorts under `/opt/local`, and Python framework installations whose resolved paths fall outside the accepted roots do not work with this discovery policy. Changing `PATH` does not fix an unsupported location. Do not weaken filesystem permissions or add unreviewed executable wrappers to bypass discovery.

## Provision the runtime separately

Obtain explicit approval before installing or upgrading packages. Provision the operating system and architecture where native processing actually runs. Installing Linux tools in a test sandbox does not install tools on a macOS DSH Host. Do not mount macOS executables into a Linux container and expect them to run.

### Linux

Use a supported distribution's authenticated package repositories. On Debian or Ubuntu, the relevant packages are `poppler-utils`, `tesseract-ocr`, and the required language packages, such as `tesseract-ocr-eng` and `tesseract-ocr-deu`. The runner also needs `prlimit`, normally supplied by `util-linux`.

Review the package manager's complete transaction before approval. Native image, font, compression, and OCR libraries are part of the dependency surface. Distribution security fixes can be backported without changing the upstream version printed by a utility, so record full package revisions as well as CLI versions.

### macOS

Use a reviewed package source, such as the official Homebrew formulas for Poppler and Tesseract. Install a working Python 3 in an accepted executable location. The runner invokes Python with `-I` and a fixed resource-limiting program, then replaces that process with the requested utility using `os.execve`. It does not use a command shell or a Python OCR package.

Apple Silicon Homebrew commonly uses `/opt/homebrew`; Intel installations commonly use `/usr/local`. Verify actual executable and symlink destinations rather than assuming a prefix. The system `/usr/bin/python3` shim is not accepted; provision a working Python through a reviewed package source. Test the exact DSH Host installation before enabling PDF reads. Native macOS execution has not been established by the Linux validation setup described below.

### Languages and offline operation

The tool accepts one to three unique language codes from `eng`, `deu`, `fra`, `spa`, `ita`, and `por`. The default is `eng`. For OCR-enabled reads, every requested language must appear in the installed Tesseract language list. Missing languages produce an error; the plugin does not download them.

The child environment does not inherit `TESSDATA_PREFIX` or other caller-selected model paths. Use trusted models installed in the utility's normal data location. Do not replace them with models supplied by a document, tool argument, or untrusted download.

## Processing behavior and bounds

`pdfinfo` checks the document before page processing. The reader rejects encrypted PDFs, including encrypted documents that open without a password. It does not attempt to bypass PDF permissions.

`pdftotext` extracts each selected page separately. With `ocr: auto`, the processor uses OCR when embedded text has fewer than 24 non-whitespace characters. This is a heuristic, not a verified assessment of the page. `ocr: off` extracts embedded text only. `ocr: force` renders and recognizes every selected page.

OCR renders one page at a time with `pdftoppm`, then passes the local image to Tesseract. The response labels pages and identifies each page's method as `embedded`, `ocr`, or `none`. Check `actualRange`, `totalPages`, `nextStartPage`, and `warnings` before claiming document coverage. OCR can misread words, numbers, and layout. Empty extracted text does not establish that a page is blank.

| Limit | Current behavior |
| --- | --- |
| PDF download | At most 20 MiB; enforced on received bytes, not only metadata |
| Document length | 1–200 pages |
| Read range | 1–5 pages, with 1-based inclusive indices; defaults to pages 1–5 or the document end |
| Concurrent PDF reads | At most 2 per reader/processor instance; excess requests fail as busy |
| Render dimensions | Long side scaled to 2,400 pixels |
| Rendered image | At most 20 MiB checked after rendering |
| Text output | The model tool defaults to 65,536 UTF-8 bytes; the internal processor defaults to 262,144. Maximum 262,144; aggregate labeled text must fit. Page provenance and file metadata add bounded overhead, not another copy of the text. |
| Processing deadline | 90 seconds for the processor |
| Download and processing deadline | 120 seconds for the PDF read stage, after metadata acquisition |
| Child wall-clock deadline | 10 seconds by default; 30 seconds for rendering and OCR |
| Child diagnostic output | At most 65,536 bytes; raw stderr is not returned |

Output overflow produces an error rather than a silently truncated PDF result. Request fewer pages or increase `maxBytes` within its maximum. A render-size check does not prevent a PDF parser from allocating memory while decoding the document.

### Operating-system limits

Linux invokes each utility through `prlimit`. macOS applies the following shared limits through Python's `resource.setrlimit` before execution:

| Resource | Linux | macOS |
| --- | --- | --- |
| CPU time | 30 seconds per child | 30 seconds per child |
| Maximum individual output file | 32 MiB | 32 MiB |
| Open file descriptors | 64 | 64 |
| Core dump size | 0 | 0 |
| Virtual address space | 512 MiB per child | No hard memory limit |

Linux's address-space limit is not a total resident-memory budget for the DSH Host or all concurrent children. The individual-file limit is not a total disk quota. Neither runner applies filesystem or network isolation. The plugin does not use `bwrap`, even if it is installed.

Children receive only fixed locale values, private `HOME` and `TMPDIR`, and `OMP_THREAD_LIMIT=1`. They do not inherit Google credentials, arbitrary environment variables, or `PATH`. Calls use argument arrays without shell interpolation.

The processor stores input and page images in a private temporary directory with mode `0700`; the input file uses mode `0600`. On cancellation, timeout, or output overflow, the runner signals the process group and escalates termination. It waits for child closure before returning control for cleanup. Normal completion and failures remove the private directory. Abrupt Host termination or an operating-system crash can leave temporary files; automatic stale-file recovery is not provided.

## Dependency provenance and security review

[Poppler's official project](https://poppler.freedesktop.org/) identifies its canonical source repository and signed release tarballs. Its release history includes frequent malformed-document crash fixes, and the project uses continuous integration and OSS-Fuzz. The [Homebrew Poppler formula](https://formulae.brew.sh/formula/poppler) reports `GPL-2.0-only OR GPL-3.0-only`. Review the actual package's copyright files and dependency licenses before redistribution; external execution is not a blanket licensing exemption.

[Tesseract's official repository](https://github.com/tesseract-ocr/tesseract) uses Apache-2.0 and identifies its Leptonica dependency, whose license is BSD-like. Its [official installation guide](https://tesseract-ocr.github.io/tessdoc/Installation.html) distinguishes the engine from language data. Review the installed language packages' copyright and provenance separately.

Linux ARM64 validation uses these installed Ubuntu 26.04 package revisions, verified with `dpkg-query`:

| Package | Installed test revision | Assessment |
| --- | --- | --- |
| `poppler-utils` and `libpoppler156` | `26.01.0-2ubuntu0.1` | Ubuntu security update; see the advisory below |
| `tesseract-ocr` and `libtesseract5` | `5.5.0-1build1` | Ubuntu Universe package; unresolved advisory status below |
| `tesseract-ocr-eng` and `tesseract-ocr-deu` | `1:4.1.0-2build1` | Distribution language-data packages; model versions differ from engine versions |

These are test-sandbox versions, not a production version recommendation or evidence of the installed state on your machine. The approved installation changes only the Linux test sandbox, not the macOS Host or its live profile. Verify actual installed revisions after any separately approved runtime installation.

Relevant advisory findings:

- [Ubuntu USN-8400-1](https://ubuntu.com/security/notices/USN-8400-1) lists Poppler `26.01.0-2ubuntu0.1` as the fix for CVE-2026-10118. Malformed tiling patterns in the Splash renderer can cause code execution, information exposure, or a crash. This fix does not establish that every vulnerability is resolved.
- [Ubuntu's CVE-2026-73067 record](https://ubuntu.com/security/CVE-2026-73067) marks Ubuntu 26.04 Tesseract as **Needs evaluation**. The [upstream CVE record](https://www.cve.org/CVERecord?id=CVE-2026-73067) describes a crafted language model causing an out-of-bounds read and crash before image processing in versions before 5.5.3. The [Tesseract 5.5.3 release](https://github.com/tesseract-ocr/tesseract/releases/tag/5.5.3) includes model-deserialization memory-safety fixes. Restrict the older test package to trusted distribution models and synthetic fixtures; do not describe it as patched or vulnerability-free.
- The npm wrapper `node-tesseract-ocr` is not used. [GHSA-8j44-735h-w4w2](https://github.com/advisories/GHSA-8j44-735h-w4w2) reports critical shell-command injection through version 2.2.1, with no patched version listed. Direct argument-array invocation avoids that wrapper's command construction, but does not eliminate native parser vulnerabilities.

For production, prefer maintained packages with verified fixes for applicable advisories, including a patched Tesseract engine or a confirmed distribution backport. If an acceptable native package is unavailable, defer native processing or provision a separately reviewed local worker environment. Recheck current advisories and all native dependencies; this research is not an exhaustive vulnerability audit.

## Reproduce validation

Run validation only in a checkout whose dependencies and test environment you have reviewed. These tests create and remove synthetic PDF/image files in temporary directories and spawn local utilities. They do not need Google credentials or a live Drive connection. Do not run them against private documents as a substitute for controlled fixtures.

1. Confirm the required binaries exist in the accepted locations and inspect their versions. Poppler utilities accept `-v`; Tesseract accepts `--version` and `--list-langs`. Record both CLI versions and full operating-system package revisions.
2. Confirm `eng` and `deu` are installed. The native OCR fixture requires both, even though ordinary reads default to English.
3. From the repository root, run the scoped tests without invoking the root build hook:

   ```sh
   node --test packages/dsh-google-drive/test/pdf.test.js packages/dsh-google-drive/test/pdf-process.test.js packages/dsh-google-drive/test/reader-pdf.test.js
   ```

There is no environment-variable opt-in for native tests. They automatically run when their prerequisite probe succeeds, and skip native cases when it fails. Installing the binaries therefore changes which tests run. Inspect the skip count: skipped native cases do not prove extraction or OCR works.

The runner probe tests additionally require `/usr/bin/python3`. A macOS installation that only supplies Python under `/opt/homebrew` can satisfy the production runner but still skip these probe tests. Contract tests for macOS invocation do not establish native macOS execution or a hard memory limit there.

If discovery fails, check the exact required binary, resolved path, ownership, and permissions. If a read fails as busy or exceeds a limit, reduce its page range or retry after another read finishes. Missing language data requires a separate administrator-approved setup action; the plugin never provisions it automatically.
