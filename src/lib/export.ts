import { api } from "./api";

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function safeFileName(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 120);
}

/** Save text (CSV, BibTeX, …) through the native save dialog. Returns the path or null. */
export async function saveText(name: string, text: string, ext = "csv"): Promise<string | null> {
  return api.saveExport(`${safeFileName(name)}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }], utf8ToBase64(text));
}

/** Save a `data:image/png;base64,…` URL as a PNG file. */
export async function savePng(name: string, dataUrl: string): Promise<string | null> {
  return api.saveExport(`${safeFileName(name)}.png`, [{ name: "PNG image", extensions: ["png"] }], dataUrl.slice(dataUrl.indexOf(",") + 1));
}
