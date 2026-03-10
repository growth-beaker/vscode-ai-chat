import { describe, it, expect } from "vitest";
import { generateHtml, generateNonce } from "../html.js";

describe("generateNonce", () => {
  it("returns a base64 string", () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("returns unique values", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
  });
});

describe("generateHtml", () => {
  const baseOptions = {
    nonce: "test-nonce-123",
    scriptUri: "https://webview/dist/webview.js",
    styleUri: "https://webview/dist/webview.css",
    cspSource: "https://webview",
  };

  it("produces valid HTML structure", () => {
    const html = generateHtml(baseOptions);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    expect(html).toContain('<div id="root"></div>');
  });

  it("includes CSP meta tag with nonce", () => {
    const html = generateHtml(baseOptions);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("'nonce-test-nonce-123'");
    expect(html).toContain("script-src 'nonce-test-nonce-123'");
    expect(html).toContain("style-src https://webview 'nonce-test-nonce-123'");
  });

  it("does not include unsafe-inline or unsafe-eval", () => {
    const html = generateHtml(baseOptions);
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toContain("unsafe-eval");
  });

  it("includes script tag with nonce and src", () => {
    const html = generateHtml(baseOptions);
    expect(html).toContain('nonce="test-nonce-123"');
    expect(html).toContain('src="https://webview/dist/webview.js"');
  });

  it("includes stylesheet link", () => {
    const html = generateHtml(baseOptions);
    expect(html).toContain('href="https://webview/dist/webview.css"');
  });

  it("includes custom CSS when provided", () => {
    const html = generateHtml({
      ...baseOptions,
      customCss: ".my-class { color: red; }",
    });
    expect(html).toContain(".my-class { color: red; }");
    expect(html).toContain(`<style nonce="test-nonce-123">`);
  });

  it("omits custom style tag when no customCss", () => {
    const html = generateHtml(baseOptions);
    expect(html).not.toContain("<style");
  });

  it("includes default-src 'none' in CSP", () => {
    const html = generateHtml(baseOptions);
    expect(html).toContain("default-src 'none'");
  });

  it("allows images from cspSource, data, and https", () => {
    const html = generateHtml(baseOptions);
    expect(html).toContain("img-src https://webview data: https:");
  });
});
