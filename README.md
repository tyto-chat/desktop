# tyto desktop

The desktop app for [tyto.chat](https://tyto.chat), for macOS, Windows and Linux.

It is a thin Electron shell around the tyto web client built in desktop mode. The shell adds what a
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

## Security

The page runs sandboxed with context isolation and no Node.js access. The preload script is the only
privileged code and exposes one narrow object to the page. The shell refuses to start rather than
store credentials without operating system encryption.

Report vulnerabilities as described in the
[client security policy](https://github.com/tyto-chat/client/blob/master/SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
