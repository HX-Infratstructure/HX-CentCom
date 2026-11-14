import { useSyncExternalStore } from "react";

/**
 * The owner key for this browser tab (SPEC 2: pasted once per session, kept in sessionStorage). This module only keeps
 * the key; the route that builds OwnerActions sends it.
 */
const STORAGE_KEY = "hx-centcom.owner-key";
// The browser fires `storage` only in other documents, never in the one that wrote, so this tab's
// own writes announce themselves with this event.
const KEY_EVENT = "hx-centcom:owner-key";

function readKey(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(KEY_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(KEY_EVENT, listener);
  };
}

function notify(): void {
  window.dispatchEvent(new Event(KEY_EVENT));
}

/**
 * The server snapshot is null, so server rendering and hydration show public mode, and the client then re-renders
 * into owner mode without a hydration mismatch.
 */
export function useOwnerKey(): string | null {
  return useSyncExternalStore(subscribe, readKey, () => null);
}

/** False when the browser refuses session storage, so the caller can say the key was not kept. */
export function rememberOwnerKey(key: string): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    return false;
  }
  notify();
  return true;
}

export function forgetOwnerKey(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was stored if storage is unavailable, so there is nothing to remove.
  }
  notify();
}
