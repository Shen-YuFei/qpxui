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
  const path = await api.chooseSavePath(`${safeFileName(name)}.${ext}`, ext.toUpperCase(), [ext]);
  if (!path) return null;
  await api.writeFileBytes(path, utf8ToBase64(text));
  return path;
}

/** Save a `data:image/png;base64,…` URL as a PNG file. */
export async function savePng(name: string, dataUrl: string): Promise<string | null> {
  const path = await api.chooseSavePath(`${safeFileName(name)}.png`, "PNG image", ["png"]);
  if (!path) return null;
  await api.writeFileBytes(path, dataUrl.slice(dataUrl.indexOf(",") + 1));
  return path;
}
