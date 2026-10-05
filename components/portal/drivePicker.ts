"use client";

/**
 * Google's own file picker, in the client's browser. They sign in to Google in its pop-up
 * and choose files; the token it gives back reaches only the files they chose (the
 * drive.file scope) — never the rest of their Drive — and the server uses it once, to
 * copy those files to NDI's Drive.
 *
 * Its "Upload" tab also takes files from their computer into their own Drive first: the
 * way in for anything over the 4 MB a direct upload allows.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export const pickerConfigured = Boolean(API_KEY && APP_ID && CLIENT_ID);

const loaded = new Map<string, Promise<void>>();
function script(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
          loaded.delete(src);
          reject(new Error(`Could not load ${new URL(src).hostname}.`));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

export type Picked = { token: string; files: { id: string; name: string; mimeType: string }[] };

/** Opens the picker; resolves with the chosen files, or null if they closed it. */
export async function pickFromDrive(): Promise<Picked | null> {
  if (!pickerConfigured) throw new Error("Google Drive is not set up for this site yet.");
  await Promise.all([script("https://apis.google.com/js/api.js"), script("https://accounts.google.com/gsi/client")]);
  await new Promise<void>((resolve) => window.gapi.load("picker", { callback: () => resolve() }));

  const token = await new Promise<string>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (r: { access_token?: string; error?: string; error_description?: string }) =>
        r.access_token ? resolve(r.access_token) : reject(new Error(r.error_description || r.error || "Google sign-in failed.")),
      error_callback: (e: { type?: string; message?: string }) =>
        reject(new Error(e.type === "popup_closed" ? "The Google window was closed." : e.message || "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt: "" });
  });

  return new Promise((resolve) => {
    const g = window.google.picker;
    const files = new g.DocsView(g.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(g.DocsViewMode.LIST);
    const shared = new g.DocsView(g.ViewId.DOCS).setEnableDrives(true).setIncludeFolders(true).setSelectFolderEnabled(false);
    const picker = new g.PickerBuilder()
      .setAppId(APP_ID)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .addView(files)
      .addView(shared)
      .addView(new g.DocsUploadView())
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .enableFeature(g.Feature.SUPPORT_DRIVES)
      .setTitle("Give Ava files from your Google Drive")
      .setCallback((data: Record<string, unknown>) => {
        const action = data[g.Response.ACTION];
        if (action === g.Action.PICKED) {
          const docs = (data[g.Response.DOCUMENTS] as Record<string, string>[]) ?? [];
          resolve({
            token,
            files: docs.map((d) => ({ id: d[g.Document.ID], name: d[g.Document.NAME], mimeType: d[g.Document.MIME_TYPE] })),
          });
        } else if (action === g.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}
