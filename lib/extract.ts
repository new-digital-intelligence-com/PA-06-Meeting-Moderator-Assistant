/**
 * Getting the words out of what clients give her: PDFs and text here, Office and Google
 * files through Drive (lib/drive.ts), web pages fetched with care.
 */
import dns from "node:dns/promises";
import net from "node:net";

/** More than this is cut: a book is not meeting knowledge, and it all has to be embedded. */
export const MAX_CHARS = 400_000;

export const extension = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "log", "html", "htm"]);
export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"]);

export function isText(name: string, mime: string) {
  return TEXT_EXT.has(extension(name)) || mime.startsWith("text/") || mime === "application/json";
}

export function isPdf(name: string, mime: string) {
  return mime === "application/pdf" || extension(name) === "pdf";
}

export function isImage(name: string, mime: string) {
  return mime.startsWith("image/") || IMAGE_EXT.has(extension(name));
}

export async function pdfText(data: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((page, i) => `[page ${i + 1}]\n${page.trim()}`).join("\n\n");
}

export function plainText(data: Buffer, name: string, mime: string): string {
  const raw = data.toString("utf8").replace(/^﻿/, "");
  return /html?$/.test(extension(name)) || mime.includes("html") ? htmlText(raw).text : raw;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A page's readable text: no scripts, styles, menus or footers. */
export function htmlText(html: string): { title: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<(head|script|style|noscript|svg|nav|footer|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre|table)>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: decodeTitle(title), text };
}

const decodeTitle = (t: string) => htmlTextOnly(t).replace(/\s+/g, " ").trim();
const htmlTextOnly = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

/* ------------------------------------------------------------------ links */

/** Addresses a fetch must never reach: this server's own network, the cloud's metadata service. */
function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function publicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https links can be read.");
  if (url.username || url.password) throw new Error("Links with a password in them are not read.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new Error(`${url.hostname} could not be found.`);
  if (addresses.some((a) => privateAddress(a.address))) throw new Error("That address is not on the public internet.");
  return url;
}

/**
 * Google Docs, Sheets, Slides and Drive files shared as "anyone with the link" have a
 * plain export address; the page itself is mostly script.
 */
function exportable(url: URL): string | null {
  if (url.hostname === "docs.google.com") {
    const m = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
    if (!m) return null;
    const [, kind, id] = m;
    if (kind === "document") return `https://docs.google.com/document/d/${id}/export?format=txt`;
    if (kind === "spreadsheets") return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
    return `https://docs.google.com/presentation/d/${id}/export/txt`;
  }
  if (url.hostname === "drive.google.com") {
    const id = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get("id");
    return id ? `https://drive.google.com/uc?export=download&id=${id}` : null;
  }
  return null;
}

const LINK_MAX_BYTES = 8 * 1024 * 1024;

/** A web page, PDF or text at a public address, as text. Redirects are checked hop by hop. */
export async function linkText(raw: string): Promise<{ title: string; text: string; url: string }> {
  const original = await publicUrl(raw.trim());
  let url = new URL(exportable(original) ?? original.toString());
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    await publicUrl(url.toString());
    res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AvaReader/1.0; +https://new-digital-intelligence.com)", Accept: "text/html,application/pdf,text/plain,*/*;q=0.5" },
      signal: AbortSignal.timeout(20_000),
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = new URL(next, url);
    if (url.hostname === "accounts.google.com") {
      throw new Error("That Google file is not shared publicly. Add it with “From Google Drive” instead.");
    }
    res = null;
  }
  if (!res) throw new Error("That link redirects too many times.");
  if (!res.ok) throw new Error(`The page answered ${res.status}.`);

  const reader = res.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LINK_MAX_BYTES) {
      await reader.cancel();
      break;
    }
    parts.push(value);
  }
  const data = Buffer.concat(parts);
  const type = res.headers.get("content-type") ?? "";
  const fallbackTitle = original.hostname + original.pathname.replace(/\/$/, "");

  if (type.includes("pdf") || data.subarray(0, 5).toString() === "%PDF-") {
    const last = original.pathname.split("/").pop() || "";
    let name = last;
    try {
      name = decodeURIComponent(last);
    } catch {
      /* as it is */
    }
    name ||= fallbackTitle;
    return { title: name, text: await pdfText(data), url: original.toString() };
  }
  const body = data.toString("utf8");
  if (type.includes("html") || /^\s*<(!doctype|html)/i.test(body)) {
    const page = htmlText(body);
    return { title: page.title || fallbackTitle, text: page.text, url: original.toString() };
  }
  return { title: fallbackTitle, text: body, url: original.toString() };
}
