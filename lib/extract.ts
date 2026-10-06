/**
 * Getting the words out of what clients give her: PDFs and text here, Office and Google
 * files through Drive (lib/drive.ts), web pages fetched with care.
 */
import { X509Certificate } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

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
const READER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; AvaReader/1.0; +https://new-digital-intelligence.com)",
  Accept: "text/html,application/pdf,text/plain,*/*;q=0.5",
};

/** One answer from a site, its body cut at LINK_MAX_BYTES. */
type Got = { status: number; location: string | null; type: string; data: Buffer };

/**
 * What a site does when it leaves its intermediate certificate out — a common slip that
 * browsers paper over by fetching the missing certificate themselves (see missingIntermediate).
 */
const MISSING_INTERMEDIATE = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT"]);

/** Node's "fetch failed" says nothing; the cause underneath, said for a person. */
function unreachable(e: unknown, url: URL): Error {
  const err = e as { name?: string; cause?: { code?: string } };
  const code = err.cause?.code ?? "";
  if (err.name === "TimeoutError" || err.name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return new Error(`${url.hostname} took too long to answer.`);
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new Error(`${url.hostname} could not be found.`);
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return new Error(`${url.hostname} refused the connection.`);
  if (code === "CERT_HAS_EXPIRED") return new Error(`${url.hostname}'s security certificate has expired, so it was not read.`);
  if (/CERT|SELF_SIGNED|ALTNAME|SSL/.test(code)) return new Error(`${url.hostname}'s security certificate is not valid (${code}), so it was not read.`);
  return new Error(`${url.hostname} could not be reached${code ? ` (${code})` : ""}.`);
}

/** One hop. A site missing its intermediate certificate gets it filled in, as a browser would. */
async function get(url: URL): Promise<Got> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: "manual", headers: READER_HEADERS, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (url.protocol !== "https:" || !code || !MISSING_INTERMEDIATE.has(code)) throw unreachable(e, url);
    const intermediate = await missingIntermediate(url);
    if (!intermediate) throw new Error(`${url.hostname}'s security certificate is incomplete, and its missing part could not be found.`);
    return getTrusting(url, intermediate);
  }
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
  return { status: res.status, location: res.headers.get("location"), type: res.headers.get("content-type") ?? "", data: Buffer.concat(parts) };
}

/**
 * The intermediate certificate a site left out. Its own certificate says where its issuer's
 * is published (Authority Information Access); that one is fetched — from a public address
 * only — and kept only if it is the one that signed the site's. Whether the chain ends in a
 * trusted root is still decided as for any site, when the page is fetched with it.
 */
async function missingIntermediate(url: URL): Promise<string | null> {
  const leaf = await new Promise<tls.PeerCertificate | null>((resolve) => {
    // Only to read its certificate: nothing is sent over this connection.
    const socket = tls.connect({ host: url.hostname, port: Number(url.port) || 443, servername: url.hostname, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate(false);
      socket.end();
      resolve(cert?.raw ? cert : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
  const published = leaf?.infoAccess?.["CA Issuers - URI"]?.[0];
  if (!leaf || !published) return null;
  const at = await publicUrl(published).catch(() => null);
  if (!at) return null;
  const res = await fetch(at, { redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return null;
  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length > 64 * 1024) return null;
  try {
    const issuer = new X509Certificate(raw);
    return new X509Certificate(leaf.raw).checkIssued(issuer) ? issuer.toString() : null;
  } catch {
    return null;
  }
}

/** One hop over https trusting the usual roots plus the intermediate the site left out. */
function getTrusting(url: URL, intermediate: string): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        // Uncompressed: fetch undoes gzip by itself, this does not.
        headers: { ...READER_HEADERS, "Accept-Encoding": "identity" },
        ca: [...tls.rootCertificates, intermediate],
        timeout: 20_000,
      },
      (res) => {
        const parts: Buffer[] = [];
        let size = 0;
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            location: typeof res.headers.location === "string" ? res.headers.location : null,
            type: String(res.headers["content-type"] ?? ""),
            data: Buffer.concat(parts),
          });
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > LINK_MAX_BYTES) res.destroy();
          else parts.push(chunk);
        });
        res.on("end", done);
        // Cut short at the size limit: what came is kept.
        res.on("close", done);
        res.on("error", (e) => reject(unreachable(e, url)));
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    req.on("error", (e) => reject(unreachable({ name: e.name, cause: e }, url)));
    req.end();
  });
}

/** A web page, PDF or text at a public address, as text. Redirects are checked hop by hop. */
export async function linkText(raw: string): Promise<{ title: string; text: string; url: string }> {
  const original = await publicUrl(raw.trim());
  let url = new URL(exportable(original) ?? original.toString());
  let got: Got | null = null;
  for (let hop = 0; hop < 5; hop++) {
    await publicUrl(url.toString());
    got = await get(url);
    const next = got.status >= 300 && got.status < 400 ? got.location : null;
    if (!next) break;
    url = new URL(next, url);
    if (url.hostname === "accounts.google.com") {
      throw new Error("That Google file is not shared publicly. Add it with “From Google Drive” instead.");
    }
    got = null;
  }
  if (!got) throw new Error("That link redirects too many times.");
  if (got.status < 200 || got.status >= 300) throw new Error(`The page answered ${got.status}.`);

  const data = got.data;
  const type = got.type;
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
