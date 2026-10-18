/**
 * Client-side slide text extraction — runs 100% in the browser, no server
 * and no API keys.
 *   - PDF  → pdfjs-dist text layers, one section per page.
 *   - PPTX → unzipped with JSZip; text runs (<a:t>) per slide.
 *   - PPT (legacy binary) → not parseable in-browser; caller should ask
 *     the user to re-save as PPTX or paste the outline as text.
 *   - TXT/MD/CSV → read as plain text.
 */

import type JSZipType from "jszip";

const PAGE_MARKER = (n: number) => `— Slide ${n} —`;

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    );
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Bundle the worker locally so nothing is fetched from a CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(`${PAGE_MARKER(n)}\n${text}`);
    page.cleanup();
  }
  return pages.join("\n\n");
}

async function extractPptx(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default as typeof JSZipType;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort(
      (a, b) =>
        Number(a.match(/(\d+)/)?.[1] ?? 0) -
        Number(b.match(/(\d+)/)?.[1] ?? 0),
    );

  if (slideFiles.length === 0) {
    throw new Error("No slides found inside this PPTX file.");
  }

  const slides: string[] = [];
  for (const [index, path] of slideFiles.entries()) {
    const xml = await zip.files[path].async("string");
    const runs = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)).map(
      (m) => decodeXml(m[1] ?? "").trim(),
    );
    const text = runs.filter(Boolean).join(" · ");
    slides.push(`${PAGE_MARKER(index + 1)}\n${text}`);
  }
  return slides.join("\n\n");
}

/** True for file names we can parse in the browser. */
export function isSupportedSlideFile(file: File): boolean {
  return /\.(pdf|pptx|ppsx|txt|md|markdown|csv)$/i.test(file.name);
}

export function isLegacyPpt(file: File): boolean {
  return /\.ppt$/i.test(file.name) && !/\.pptx$/i.test(file.name);
}

/**
 * Extracts normalized slide text from an uploaded file.
 * Throws with a user-friendly message on failure.
 */
export async function extractSlideText(file: File): Promise<string> {
  if (/\.pdf$/i.test(file.name)) return extractPdf(file);
  if (/\.(pptx|ppsx)$/i.test(file.name)) return extractPptx(file);
  if (isLegacyPpt(file)) {
    throw new Error(
      "Legacy .ppt files can't be parsed in the browser — re-save as .pptx or paste your outline as text.",
    );
  }
  return file.text();
}
