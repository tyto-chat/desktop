import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { resolveAppPath } from "./appPath";
import { contentSecurityPolicy } from "./navigationPolicy";

export { resolveAppPath } from "./appPath";

export const APP_SCHEME = "app";
export const APP_HOST = "tyto";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function registerAppProtocol(rendererDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response(null, { status: 404 });
    const file = await net.fetch(
      pathToFileURL(resolveAppPath(url.pathname, rendererDir)).toString(),
    );
    const headers = new Headers(file.headers);
    headers.set("Content-Security-Policy", contentSecurityPolicy());
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(file.body, { status: file.status, headers });
  });
}
