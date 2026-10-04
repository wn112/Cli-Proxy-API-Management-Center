import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { QUOTA_TAB_ORDER } from './constants';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

/** A display observation, derived only from normalized provider state. */
export interface QuotaWindowObservation {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  remaining: number | null;
  resetAtMs?: number | null;
  resetLabel?: string;
  periodHours?: number | null;
}

export interface QuotaWindowSummary extends QuotaWindowObservation {
  key: string;
  capacity: number;
  knownCount: number;
  unknownCount: number;
  nextResetAtMs: number | null;
  segments: { key: string; name: string; remaining: number | null }[];
}

export interface ProviderQuotaSummary {
  provider: QuotaProviderType;
  accountCount: number;
  unqueriedCount: number;
  loadingCount: number;
  errorCount: number;
  windows: QuotaWindowSummary[];
}

const percent = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
const remainingFromUsed = (value: unknown): number | null => {
  const used = percent(value);
  return used === null ? null : 100 - used;
};

/** No raw payloads, fetches, assumed model quotas or billing-to-token conversions. */
export function quotaWindows(
  provider: QuotaProviderType,
  quota: unknown
): QuotaWindowObservation[] {
  if (!quota || (quota as QuotaCardState).status !== 'success') return [];
  if (provider === 'claude' || provider === 'codex') {
    return ((quota as ClaudeQuotaState | CodexQuotaState).windows ?? []).map((window) => ({
      ...window,
      remaining: remainingFromUsed(window.usedPercent),
    }));
  }
  if (provider === 'devin') {
    return ((quota as DevinQuotaState).windows ?? []).map((window) => ({
      ...window,
      label: window.label ?? window.id,
      labelKey: `devin_quota.${window.id}`,
      remaining: percent(window.remainingPercent),
    }));
  }
  if (provider === 'antigravity') {
    return ((quota as AntigravityQuotaState).groups ?? []).flatMap((group) =>
      group.buckets.map((bucket) => ({
        ...bucket,
        id: `${group.id}:${bucket.id}`,
        label: `${group.label} · ${bucket.label}`,
        remaining: percent(bucket.remainingFraction * 100),
      }))
    );
  }
  if (provider === 'kimi') {
    return ((quota as KimiQuotaState).rows ?? []).map((row) => ({
      ...row,
      label: row.label ?? row.id,
      remaining: row.limit > 0 ? percent(((row.limit - row.used) / row.limit) * 100) : null,
    }));
  }
  if (provider === 'meta') {
    return ((quota as MetaQuotaState).data?.windows ?? []).map((window) => ({
      id: window.id,
      label: window.id,
      labelKey:
        window.id === 'window' && window.durationMinutes
          ? 'meta_quota.window_duration'
          : `meta_quota.${window.id}`,
      labelParams: window.durationMinutes ? { minutes: window.durationMinutes } : undefined,
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: window.resetAt === undefined ? null : window.resetAt * 1000,
      periodHours: window.durationMinutes ? window.durationMinutes / 60 : null,
    }));
  }
  const billing = (quota as XaiQuotaState).billing;
  if (!billing || billing.mode === 'paid-health' || billing.periodType !== 'weekly') return [];
  return [
    {
      id: 'weekly',
      label: 'Weekly limit',
      labelKey: 'xai_quota.weekly_limit',
      remaining: remainingFromUsed(billing.usagePercent),
      resetAtMs: billing.resetAtMs,
      periodHours: billing.periodHours,
    },
  ];
}

// A primary Codex window may mean five hours on one plan and a week on another.
// Keep those separate, and never pool a model limit with the overall limit.
// Kimi IDs are positional, so the reported label/scope is part of the identity.
const windowKey = (window: QuotaWindowObservation) =>
  JSON.stringify([
    window.id,
    window.periodHours ?? null,
    window.labelKey ?? window.label,
    Object.entries(window.labelParams ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);

/** Totals are percentage points, not a shared token balance across plans. */
export function buildProviderSummaries(
  entries: readonly QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  now = Date.now()
): ProviderQuotaSummary[] {
  return QUOTA_TAB_ORDER.flatMap((provider) => {
    const accounts = entries
      .filter((entry) => entry.type === provider)
      .map((entry) => {
        const quota = quotaFor(entry);
        const windows = new Map<string, QuotaWindowObservation>();
        for (const window of quotaWindows(provider, quota)) {
          if (!windows.has(windowKey(window))) windows.set(windowKey(window), window);
        }
        return { entry, quota, windows };
      });
    if (accounts.length === 0) return [];
    const definitions = new Map<string, QuotaWindowObservation>();
    for (const account of accounts) {
      for (const [key, window] of account.windows) {
        if (!definitions.has(key)) definitions.set(key, window);
      }
    }
    const windows = [...definitions].map(([key, window]): QuotaWindowSummary => {
      const segments = accounts.map((account) => ({
        key: getQuotaCacheKey(account.entry.file),
        name: getQuotaDisplayName(account.entry.file),
        remaining: account.windows.get(key)?.remaining ?? null,
      }));
      const known = segments.filter((segment) => segment.remaining !== null);
      const resets = accounts
        .map((account) => account.windows.get(key)?.resetAtMs)
        .filter((at): at is number => typeof at === 'number' && Number.isFinite(at) && at > now);
      return {
        ...window,
        key,
        remaining: known.length
          ? known.reduce((sum, segment) => sum + segment.remaining!, 0)
          : null,
        capacity: known.length * 100,
        knownCount: known.length,
        unknownCount: accounts.length - known.length,
        nextResetAtMs: resets.length ? Math.min(...resets) : null,
        segments,
      };
    });
    // Weekly overall limits are the most useful headline for multi-account work.
    // Stable ordering preserves every supplied secondary/model window below it.
    windows.sort((a, b) => {
      const rank = (window: QuotaWindowObservation) =>
        window.periodHours === 168 &&
        ['seven-day', 'primary', 'secondary', 'weekly', 'summary'].includes(window.id)
          ? 0
          : 1;
      return rank(a) - rank(b);
    });
    return [
      {
        provider,
        accountCount: accounts.length,
        unqueriedCount: accounts.filter(({ quota }) => !quota || quota.status === 'idle').length,
        loadingCount: accounts.filter(({ quota }) => quota?.status === 'loading').length,
        errorCount: accounts.filter(({ quota }) => quota?.status === 'error').length,
        windows,
      },
    ];
  });
}
