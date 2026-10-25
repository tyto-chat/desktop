# tyto.chat desktop

[![CI](https://github.com/tyto-chat/desktop/actions/workflows/ci.yml/badge.svg?branch=1.0)](https://github.com/tyto-chat/desktop/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/tyto-chat/desktop?include_prereleases&label=release)](https://github.com/tyto-chat/desktop/releases)
[![License: MIT](https://img.shields.io/github/license/tyto-chat/desktop)](LICENSE)

The desktop app for [tyto.chat](https://tyto.chat), for macOS, Windows and Linux.

It is a thin Electron shell around the Tyto web client built in desktop mode. The shell adds what a
browser tab cannot: credentials kept in the operating system keychain, a tray icon, native
notifications, `tyto://` links and automatic updates. All chat features live in the
[client](https://github.com/tyto-chat/client).

## Requirements

- Node.js 22.12 or newer
- git and bash
- Linux only: a running secret service such as GNOME Keyring or KWallet

## Development

```bash
npm install
npm run build:client   # builds the client pinned in client-ref into app/renderer
npm start
```

To run the shell against a client dev server instead of the bundled build:

```bash
TYTO_DEV_URL=https://client.ddev.site npm start
```

To bundle a local client checkout instead of the pinned one:

```bash
TYTO_CLIENT_REPO=/path/to/client TYTO_CLIENT_REF=my-branch npm run build:client
```

| Command                | What it does                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`             | Unit tests                                                                                                                               |
| `npm run typecheck`    | Type check                                                                                                                               |
| `npm run lint`         | Lint                                                                                                                                     |
| `npm run format:check` | Formatting check                                                                                                                         |
| `npm run smoke`        | Starts the app with its window hidden and checks that it boots and the bridge works. Needs a display: use `xvfb-run` where there is none |
| `npm run pack`         | Unpacked build for the current platform in `dist/`                                                                                       |
| `npm run dist`         | Installers for the current platform in `dist/`                                                                                           |
| `npm run dist:arch`    | Arch Linux package in `dist/`. Run it in the `electronuserland/builder` Docker image; the packaging tool does not start on Arch itself   |
| `npm run icons`        | Regenerates app and tray icons from `build/icon.svg`                                                                                     |

## Which client gets bundled

`client-ref` holds the commit or tag of `tyto-chat/client` that a build packages. Changing the
bundled client means changing that file and releasing a new desktop version.

## Releasing

1. Set `version` in `package.json`.
2. Update `client-ref` if the release should carry a newer client.
3. Commit, then tag the commit `v<version>` and push the tag.

The release workflow builds installers for all three platforms and publishes them to the GitHub
release for that tag. A platform without a signing certificate is still built, unsigned, and its
release is marked as a prerelease.

Windows and macOS builds are currently unsigned, so SmartScreen and Gatekeeper warn on first run.
We are working on code signing; the policy that will apply once builds are signed is at
<https://tyto.chat/docs/code-signing>.

## Security

The page runs sandboxed with context isolation and no Node.js access. The preload script is the only
privileged code and exposes one narrow object to the page. The shell refuses to start rather than
store credentials without operating system encryption.

Report vulnerabilities as described in the [security policy](SECURITY.md).

## About this project and AI usage

AI is part of the daily workflow behind the desktop app, and a large part of this shell was written
with it. The app is deliberately thin, so most of what matters is a handful of security-sensitive
pieces: credential storage, the preload bridge and the updater. Every product and architecture
decision is a human one, AI-produced code is reviewed before it lands, and the app is tested by hand
on real machines before releases. The practices that keep a project like this healthy are enforced
regardless of who wrote a given line: type checking, linting, formatting and the unit test suite run
on every pull request on Linux, macOS and Windows, a smoke test boots the packaged shell, and the
shell has gone through a dedicated security review.

Hands-on testing has been done on Linux and Windows. The macOS build is produced by CI but has not
yet been run on real hardware.

AI was also used to translate the tray menu into the supported languages. Translations into
languages the maintainer does not speak have not been reviewed by native speakers yet; corrections
are welcome.

## License

MIT, see [LICENSE](LICENSE).
