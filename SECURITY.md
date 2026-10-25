# Security Policy

This is the desktop app for tyto.chat. We take the security of the app and of
the people who use it seriously.

## Supported versions

Security fixes are provided for the latest release. Please update to the
newest version before reporting. Older versions do not receive backported
fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately through either channel:

- **GitHub Security Advisories** — open a private advisory at
  <https://github.com/tyto-chat/desktop/security/advisories/new>. This is the
  preferred channel.
- **Email** — security@tyto.chat with the details below.

Include, where possible:

- a description of the vulnerability and its impact,
- the affected component, endpoint, or file,
- steps to reproduce (proof-of-concept, request/response, or a minimal script),
- the version or commit you tested against,
- any suggested remediation.

## What to expect

tyto.chat is an open-source project maintained on a best-effort basis, so we
do not commit to fixed response or resolution windows. Every report is taken
seriously, and we will:

- **acknowledge** your report and apply best effort to respond as quickly as
  we can,
- **assess** its severity, the affected versions, and a remediation plan,
- **fix and disclose** — prioritising by severity, with actively exploited or
  high-severity issues handled first — and coordinate a disclosure timeline
  with you, crediting you in the advisory unless you prefer to remain
  anonymous.

We do not run a bug-bounty programme and cannot offer monetary rewards, but
every genuine report is appreciated.

## Scope

In scope: the code in this repository: the main process, the preload bridge,
IPC, credential storage, the updater, and the packaging and release workflows.

Out of scope: vulnerabilities in third-party dependencies (report those
upstream, though we appreciate a heads-up), vulnerabilities in the web client
or the server (report those in their own repositories), and findings that
depend on physical access to an unlocked device.

The software is provided "as is", without warranty of any kind, as set out in
the MIT License.
