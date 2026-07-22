// Server-driven feature flags — currently one that matters: advisory_mode.
//
// When OFF (the default for everyone except the owner until SEBI registration
// exists), every advice-shaped element renders in neutral analytics language:
// no BUY/SELL actions, no "target"/"stop-loss" framing (the same price levels
// appear as resistance/support zones), no "confidence"/"probability" wording
// (scores stay, as mechanical rule outputs), no time-to-target estimates.
// The flag is fetched once at boot and again after sign-in/out; the safe
// default before the server answers is OFF.
import { useEffect, useState } from 'react';
import { API_BASE } from './api';

type Flags = { advisory_mode: boolean; accounts: boolean; signed_in: boolean };

let flags: Flags = { advisory_mode: false, accounts: false, signed_in: false };
const listeners = new Set<() => void>();

export function advisoryOn(): boolean {
  return flags.advisory_mode;
}
export function accountsEnabled(): boolean {
  return flags.accounts;
}

export async function refreshFlags(): Promise<void> {
  try {
    const res = await fetch(API_BASE + '/flags', { credentials: 'include' });
    const d = (await res.json()) as Flags;
    if (typeof d.advisory_mode === 'boolean') {
      flags = d;
      listeners.forEach((l) => {
        try {
          l();
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    /* keep the safe default */
  }
}

export function subscribeFlags(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Re-render on flag change; returns whether advisory framing is allowed.
export function useAdvisory(): boolean {
  const [on, setOn] = useState(flags.advisory_mode);
  useEffect(() => subscribeFlags(() => setOn(flags.advisory_mode)), []);
  return on;
}

// Neutral-vs-advisory vocabulary in one place, so every screen renders the
// same words. Levels themselves are factual chart structure and stay visible.
export function lvlLabels(advisory: boolean) {
  return advisory
    ? { entry: 'ENTRY', stop: 'STOP LOSS', target: 'TARGET', upside: 'UPSIDE', prob: 'probability', conf: 'confidence' }
    : { entry: 'PIVOT', stop: 'SUPPORT', target: 'RESISTANCE', upside: 'TO RESISTANCE', prob: 'score', conf: 'score' };
}
