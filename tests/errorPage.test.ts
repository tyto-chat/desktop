import { describe, expect, it } from "vitest";
import { KEYCHAIN_DOCS_URL, keychainErrorHtml } from "../src/main/errorPage";

describe("keychainErrorHtml", () => {
  it("explains the problem and links to the docs", () => {
    const html = keychainErrorHtml(KEYCHAIN_DOCS_URL);
    expect(html).toContain("system keychain");
    expect(html).toContain(`href="${KEYCHAIN_DOCS_URL}"`);
  });

  it("forbids scripts and remote resources", () => {
    const html = keychainErrorHtml(KEYCHAIN_DOCS_URL);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
  });

  it("escapes the link it is given", () => {
    const html = keychainErrorHtml('https://x.example/"><script>alert(1)</script>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("uses the product's short name, capitalised", () => {
    const html = keychainErrorHtml(KEYCHAIN_DOCS_URL);
    expect(html).toContain("<title>Tyto</title>");
    expect(html).toContain("Tyto can't reach your system keychain");
    expect(html.replaceAll(KEYCHAIN_DOCS_URL, "")).not.toMatch(/\btyto\b/);
  });
});
