// Spending credits from the UI.
//
// The server has priced actions and an idempotent /wallet/spend; this is the
// client half. It exists so no screen writes its own charging logic: the ref
// discipline below is the only thing standing between a dropped connection and
// a double charge, and it is not something to reinvent per screen.
//
// Policy, deliberately simple: a plan that grants the feature never pays
// credits. Credits are the way IN for someone whose plan does not cover it —
// the escape valve from a paywall, not a second toll on people already paying.
import { api } from './api';
import { hasFeature } from './member';

export type ChargeResult =
  | { ok: true; spent: number; balance: number }
  | { ok: false; reason: 'covered-by-plan' }
  | { ok: false; reason: 'insufficient'; needed: number; balance: number }
  | { ok: false; reason: 'unavailable'; detail: string };

const listeners = new Set<() => void>();

/** Anything showing a balance can subscribe; the header pill does. */
export function subscribeCredits(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function emit() {
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

/**
 * Charge for one metered action.
 *
 * `ref` MUST be stable for the same piece of work — the same symbol, the same
 * backtest parameters — so a retry cannot charge twice. The server enforces it
 * with a unique index; passing a random value each time would defeat that.
 */
export async function chargeFor(
  action: string,
  ref: string,
  opts: { feature?: string } = {},
): Promise<ChargeResult> {
  if (opts.feature && hasFeature(opts.feature)) {
    return { ok: false, reason: 'covered-by-plan' };
  }
  try {
    const res = await api.walletSpend(action, ref);
    if (res.ok) {
      emit();
      return { ok: true, spent: res.spent ?? 0, balance: res.balance ?? 0 };
    }
    if (res.error === 'insufficient-credits') {
      return { ok: false, reason: 'insufficient', needed: res.needed ?? 0, balance: res.balance ?? 0 };
    }
    return { ok: false, reason: 'unavailable', detail: res.detail || 'Could not charge credits.' };
  } catch (e) {
    // The money routes are preview-gated, so a 404 off the preview host is
    // expected rather than broken. Either way the caller must not proceed as
    // though it had paid.
    return {
      ok: false,
      reason: 'unavailable',
      detail: e instanceof Error ? e.message : 'Credits are not available here.',
    };
  }
}

/** Human sentence for a failed charge — screens should not compose their own. */
export function chargeMessage(r: ChargeResult): string {
  if (r.ok) return `${r.spent} credits used · ${r.balance} left`;
  switch (r.reason) {
    case 'covered-by-plan':
      return 'Included in your plan.';
    case 'insufficient':
      return `Needs ${r.needed} credits — you have ${r.balance}. Earn more in Wallet.`;
    default:
      return r.detail;
  }
}
