// Protection for sharing the app with testers (e.g. through a tunnel link).
// - an optional ACCESS_CODE: without the right cookie the API (and the microphone socket) refuse to work
// - a simple rate limiter so a runaway page or a leaked link cannot run up the API bills
// Pure helpers, tested without a server.

import { timingSafeEqual } from 'node:crypto';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export const COOKIE = 'rc_access';

// With no ACCESS_CODE set everyone is allowed (normal local use).
export function isAuthorized(accessCode, cookieHeader) {
  if (!accessCode) return true;
  const got = parseCookies(cookieHeader)[COOKIE];
  return got !== undefined && safeEqual(got, accessCode);
}

export function accessCookie(accessCode, secure) {
  return `${COOKIE}=${encodeURIComponent(accessCode)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}${secure ? '; Secure' : ''}`;
}

export const codeMatches = (accessCode, given) => !!accessCode && given != null && safeEqual(given, accessCode);

// Sliding-window limiter: at most `max` hits per `windowMs` for each key.
export class RateLimiter {
  constructor(max, windowMs = 60000) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  hit(key = 'all', now = Date.now()) {
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
