// Spending credits from the UI.
//
// The server has priced actions and an idempotent /wallet/spend; this is the
// client half. It exists so no screen writes its own charging logic: the ref
// discipline below is the only thing standing between a dropped connection and
// a double charge, and it is not something to reinvent per screen.
//
// Policy: credits meter HOW MUCH of a feature you use. They never decide
// WHETHER you may use it — that is the plan's job, and only the plan's. An
// account whose plan does not carry a feature is refused ('plan-required') no
// matter what its balance is; the server enforces that, and this module only
// reports it.
//
// It used to be the other way round: a plan that granted the feature paid
// nothing and credits were the way IN for everyone else, which made the wallet
// a second, cheaper paywall running beside the real one. Now the people who
// pay credits are the ones already on the plan, and the monthly credit grant
// that comes with a plan is what funds their usage.
import { api } from './api';

export type ChargeResult =
  | { ok: true; spent: number; balance: number }
  | { ok: false; reason: 'plan-required'; requiredPlan: string; detail: string }
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

type ServerError = Error & {
  code?: string;
  status?: number;
  body?: { needed?: number; balance?: number; required_plan?: string; detail?: string };
};

/**
 * Charge for one metered action.
 *
 * `ref` MUST be stable for the same piece of work — the same symbol, the same
 * backtest parameters — so a retry cannot charge twice. The server enforces it
 * with a unique index; passing a random value each time would defeat that.
 */
export async function chargeFor(action: string, ref: string): Promise<ChargeResult> {
  try {
    const res = await api.walletSpend(action, ref);
    if (res.ok) {
      emit();
      return { ok: true, spent: res.spent ?? 0, balance: res.balance ?? 0 };
    }
    // A 2xx that is not ok should not happen; treat it as a refusal rather
    // than letting the caller proceed as though it had paid.
    return { ok: false, reason: 'unavailable', detail: res.detail || 'Could not charge credits.' };
  } catch (e) {
    // Refusals arrive as thrown errors carrying the server's machine tag and
    // its sentence — 403 for entitlement, 402 for an empty wallet.
    const err = e as ServerError;
    if (err.code === 'plan-required') {
      return {
        ok: false,
        reason: 'plan-required',
        requiredPlan: err.body?.required_plan || '',
        detail: err.message,
      };
    }
    if (err.code === 'insufficient-credits') {
      return {
        ok: false,
        reason: 'insufficient',
        needed: err.body?.needed ?? 0,
        balance: err.body?.balance ?? 0,
      };
    }
    // The money routes are preview-gated, so a 404 off the preview host is
    // expected rather than broken. Either way the caller must not proceed as
    // though it had paid.
    return {
      ok: false,
      reason: 'unavailable',
      detail: err instanceof Error ? err.message : 'Credits are not available here.',
    };
  }
}

/**
 * Whether a charge result should stop the work.
 *
 * Refusals stop it: the plan does not carry the feature, or the wallet is
 * empty. A charge that could not be ATTEMPTED does not — the money routes are
 * preview-gated and can 404, and a meter that is unreachable must not put a
 * wall in front of someone who has already paid for the feature. Entitlement
 * fails closed; metering fails open. One rule, in one place, so no screen
 * decides it differently.
 */
export function blocks(r: ChargeResult): boolean {
  return !r.ok && r.reason !== 'unavailable';
}

/** Human sentence for a failed charge — screens should not compose their own. */
export function chargeMessage(r: ChargeResult): string {
  if (r.ok) return `${r.spent} credits used · ${r.balance} left`;
  switch (r.reason) {
    case 'plan-required':
      return r.detail || 'Your plan does not include this.';
    case 'insufficient':
      return `Needs ${r.needed} credits — you have ${r.balance}. Earn more in Wallet.`;
    default:
      return r.detail;
  }
}
