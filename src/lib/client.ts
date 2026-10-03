'use client';

// The site's access token lives in this tab's memory (and sessionStorage for reloads); the
// refresh token is an http-only cookie the page never sees.
const KEY = 'df_access';

export function setAccessToken(token: string | null) {
  try {
    if (token) {
      sessionStorage.setItem(KEY, token);
    } else {
      sessionStorage.removeItem(KEY);
    }
  } catch {
    // storage blocked: the cookie still signs the page in on each load
  }
}

export function getAccessToken() {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** A fresh access token from the refresh cookie, or null when signed out. */
export async function refreshAccess(): Promise<string | null> {
  const response = await fetch('/api/auth/refresh', { method: 'POST' });
  if (!response.ok) {
    setAccessToken(null);
    return null;
  }
  const data = (await response.json()) as { accessToken: string };
  setAccessToken(data.accessToken);
  return data.accessToken;
}

/** fetch with the access token, refreshing it once if it has expired. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  let token = getAccessToken() ?? (await refreshAccess());
  if (!token) {
    return null;
  }
  const call = (t: string) => fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
  let response = await call(token);
  if (response.status === 401) {
    token = await refreshAccess();
    if (!token) {
      return null;
    }
    response = await call(token);
  }
  return response.ok ? ((await response.json()) as T) : null;
}

/** As api(), with the server's error message when it fails. */
export async function apiResult<T>(path: string, init: RequestInit = {}): Promise<{ data: T | null; error: string | null }> {
  let token = getAccessToken() ?? (await refreshAccess());
  if (!token) {
    return { data: null, error: 'Signed out: sign in again' };
  }
  const call = (t: string) => fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
  let response = await call(token);
  if (response.status === 401) {
    token = await refreshAccess();
    if (!token) {
      return { data: null, error: 'Signed out: sign in again' };
    }
    response = await call(token);
  }
  const body = await response.json().catch(() => null);
  return response.ok ? { data: body as T, error: null } : { data: null, error: (body as { error?: string } | null)?.error ?? `Error ${response.status}` };
}

const NAMES: Record<string, string> = {
  SheepMilk: "Sheep's milk",
  Milk: 'Milk',
  Egg: 'Egg',
  Wool: 'Wool',
  Leather: 'Leather',
};

export function itemName(id: string) {
  return NAMES[id] ?? id;
}
