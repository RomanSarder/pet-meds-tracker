// Slice 11 (PWA & polish): the manifest, its icons, and `index.html`'s
// links live under `frontend/public/` and `frontend/index.html`, both
// outside the TS project, so — like `sw.js` — they get exercised here by
// reading the files straight off disk rather than importing them.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const INDEX_HTML = path.resolve(__dirname, "../../index.html");

interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

function readManifest(): Manifest {
  const raw = readFileSync(path.join(PUBLIC_DIR, "manifest.webmanifest"), "utf-8");
  return JSON.parse(raw) as Manifest;
}

describe("manifest.webmanifest", () => {
  it("exists and parses as JSON", () => {
    expect(() => readManifest()).not.toThrow();
  });

  it("declares the fields Chrome's installability check requires", () => {
    const manifest = readManifest();
    expect(manifest.name).toBe("Pet Meds");
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("has at least a 192px and a 512px icon, plus a maskable entry", () => {
    const { icons } = readManifest();
    expect(icons.length).toBeGreaterThan(0);

    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");

    const maskable = icons.filter((icon) => icon.purpose === "maskable");
    expect(maskable.length).toBeGreaterThan(0);
  });

  it("every referenced icon file exists on disk and is non-empty", () => {
    const { icons } = readManifest();
    for (const icon of icons) {
      const filePath = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ""));
      expect(existsSync(filePath), `${icon.src} should exist`).toBe(true);
      expect(statSync(filePath).size, `${icon.src} should be non-empty`).toBeGreaterThan(0);
    }
  });
});

describe("index.html", () => {
  function readIndexHtml(): string {
    return readFileSync(INDEX_HTML, "utf-8");
  }

  it("links the web app manifest", () => {
    const html = readIndexHtml();
    expect(html).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/?>/);
  });

  it("declares a theme-color meta tag matching the manifest's", () => {
    const html = readIndexHtml();
    const manifest = readManifest();
    const match = html.match(/<meta\s+name="theme-color"\s+content="(#[0-9a-fA-F]{6})"\s*\/?>/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(manifest.theme_color);
  });

  it("declares an apple-touch-icon that points at a real file", () => {
    const html = readIndexHtml();
    const match = html.match(/<link\s+rel="apple-touch-icon"\s+href="(\/[^"]+)"\s*\/?>/);
    expect(match).not.toBeNull();
    const filePath = path.join(PUBLIC_DIR, (match?.[1] ?? "").replace(/^\//, ""));
    expect(existsSync(filePath)).toBe(true);
  });
});
