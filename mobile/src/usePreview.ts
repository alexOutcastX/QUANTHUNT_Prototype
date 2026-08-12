import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Whether this host may see unreleased features.
 *
 * taureye.com and 161.118.174.177 are the same server, so the answer comes
 * from the backend (which reads the Host header) rather than from anything the
 * client can work out for itself — the native shell's own origin is
 * https://localhost regardless of which API it is pointed at.
 *
 * Cached at module scope: the answer cannot change within a session, and every
 * screen that gates on it would otherwise refetch.
 */
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

export function fetchPreview(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api.preview()
      .then((r) => { cached = !!r.preview; return cached; })
      // A failure here must not light up unreleased UI. Default to hidden.
      .catch(() => { cached = false; return false; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function usePreview(): boolean {
  const [on, setOn] = useState(cached ?? false);
  useEffect(() => {
    let alive = true;
    fetchPreview().then((v) => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, []);
  return on;
}

/** Test seam — resets the module-level cache. */
export function _resetPreview() {
  cached = null;
  inflight = null;
}
