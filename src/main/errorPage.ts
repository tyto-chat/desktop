export const KEYCHAIN_DOCS_URL = "https://tyto.chat/docs/desktop/keychain";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function keychainErrorHtml(docsUrl: string): string {
  const href = escapeHtml(docsUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Tyto</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f1117;
    color: #e6e8ee; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 30rem; padding: 2rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { margin: 0 0 0.75rem; color: #a9afbf; }
  a { color: #22d3ee; }
</style>
</head>
<body>
<main>
  <h1>Tyto can't reach your system keychain</h1>
  <p>Tyto stores your sign-in details encrypted with a key kept by your operating system. No keychain
  service is available, so Tyto will not start rather than store them unprotected.</p>
  <p>On Linux, install and unlock a secret service such as GNOME Keyring or KWallet, then start Tyto
  again.</p>
  <p><a href="${href}">${href}</a></p>
</main>
</body>
</html>`;
}
