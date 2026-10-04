import { describe, expect, test } from 'bun:test';
import type { ClaudeQuotaState, CodexQuotaState, KimiQuotaState, XaiQuotaState } from '@/types';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { buildProviderSummaries, quotaWindows } from '@/features/quota/summary';

const entry = (name: string, type: QuotaFileEntry['type'] = 'claude'): QuotaFileEntry => ({
  type,
  file: { name, type },
});
const weekly = (usedPercent: number | null): ClaudeQuotaState => ({
  status: 'success',
  windows: [
    { id: 'seven-day', label: '7-day limit', usedPercent, resetLabel: '', periodHours: 168 },
  ],
});

describe('provider quota summaries', () => {
  test('sums the same reported window across five accounts without averaging', () => {
    const quotas = [42, 0, 0, 49, 0].map(weekly);
    const summary = buildProviderSummaries(
      quotas.map((_, i) => entry(String(i))),
      (item) => quotas[Number(item.file.name)]
    );
    expect(summary[0].windows[0]).toMatchObject({
      remaining: 409,
      capacity: 500,
      knownCount: 5,
      unknownCount: 0,
    });
  });

  test('does not turn unloaded, failed or missing percentages into free capacity', () => {
    const quotas = [
      weekly(25),
      undefined,
      { status: 'error' as const },
      weekly(null),
      { status: 'success' as const, windows: [] },
    ];
    const [summary] = buildProviderSummaries(
      quotas.map((_, i) => entry(String(i))),
      (item) => quotas[Number(item.file.name)]
    );
    expect(summary).toMatchObject({ accountCount: 5, unqueriedCount: 1, errorCount: 1 });
    expect(summary.windows[0]).toMatchObject({
      remaining: 75,
      capacity: 100,
      knownCount: 1,
      unknownCount: 4,
    });
    expect(summary.windows[0].segments.map((segment) => segment.remaining)).toEqual([
      75,
      null,
      null,
      null,
      null,
    ]);
  });

  test('keeps an entirely unqueried provider visible with no invented windows', () => {
    const [summary] = buildProviderSummaries([entry('a', 'codex')], () => undefined);
    expect(summary).toMatchObject({
      provider: 'codex',
      accountCount: 1,
      windows: [],
      unqueriedCount: 1,
    });
  });

  test('does not merge different periods or model windows into an overall total', () => {
    const quotas: CodexQuotaState[] = [
      {
        status: 'success',
        windows: [
          { id: 'primary', label: '5-hour limit', usedPercent: 50, resetLabel: '', periodHours: 5 },
          {
            id: 'secondary',
            label: 'Weekly limit',
            usedPercent: 80,
            resetLabel: '',
            periodHours: 168,
          },
          { id: 'review', label: 'Code review', usedPercent: 0, resetLabel: '', periodHours: 168 },
        ],
      },
      {
        status: 'success',
        windows: [
          {
            id: 'primary',
            label: 'Weekly limit',
            usedPercent: 10,
            resetLabel: '',
            periodHours: 168,
          },
        ],
      },
    ];
    const [summary] = buildProviderSummaries(
      [entry('0', 'codex'), entry('1', 'codex')],
      (item) => quotas[Number(item.file.name)]
    );
    expect(summary.windows).toHaveLength(4);
    expect(summary.windows.every((window) => window.capacity === 100)).toBe(true);
  });

  test('deduplicates duplicate windows in one account and rejects non-finite percentages', () => {
    const quota = weekly(20);
    quota.windows.push({ ...quota.windows[0] });
    const [summary] = buildProviderSummaries([entry('a'), entry('b')], (item) =>
      item.file.name === 'a' ? quota : weekly(Number.NaN)
    );
    expect(summary.windows[0]).toMatchObject({ remaining: 80, capacity: 100, knownCount: 1 });
  });

  test('keeps zero remaining distinct from unknown and does not reuse stale error payloads', () => {
    expect(quotaWindows('claude', weekly(100))[0].remaining).toBe(0);
    expect(quotaWindows('claude', { ...weekly(0), status: 'error' })).toEqual([]);
    const [summary] = buildProviderSummaries([entry('a')], () => weekly(null));
    expect(summary.windows[0]).toMatchObject({ remaining: null, capacity: 0 });
  });

  test('only reports an upcoming reset from accounts that supplied the window', () => {
    const quota = weekly(30);
    quota.windows[0].resetAtMs = 5000;
    const [summary] = buildProviderSummaries([entry('a')], () => quota, 1000);
    expect(summary.windows[0].nextResetAtMs).toBe(5000);
    expect(
      buildProviderSummaries([entry('a')], () => quota, 6000)[0].windows[0].nextResetAtMs
    ).toBeNull();
  });

  test('retains supplied secondary model labels without injecting any model quota', () => {
    const quota = weekly(30);
    quota.windows.push({
      id: 'custom-model',
      label: 'Reported model',
      usedPercent: 10,
      resetLabel: '',
    });
    expect(quotaWindows('claude', quota).map((window) => window.label)).toEqual([
      '7-day limit',
      'Reported model',
    ]);
  });
});

describe('provider observations', () => {
  test('does not pool positional Kimi windows with different reported scopes', () => {
    const quotas: KimiQuotaState[] = ['Model A', 'Model B'].map((label) => ({
      status: 'success',
      rows: [{ id: 'limit-0', label, used: 20, limit: 100, periodHours: 168 }],
    }));
    const [summary] = buildProviderSummaries(
      [entry('0', 'kimi'), entry('1', 'kimi')],
      (item) => quotas[Number(item.file.name)]
    );
    expect(summary.windows).toHaveLength(2);
    expect(summary.windows.map((window) => window.capacity)).toEqual([100, 100]);
  });

  test('uses remaining units for Devin, fractions for Antigravity and usage units for Meta', () => {
    expect(
      quotaWindows('devin', {
        status: 'success',
        windows: [{ id: 'weekly', remainingPercent: 71, periodHours: 168 }],
      })[0].remaining
    ).toBe(71);
    expect(
      quotaWindows('antigravity', {
        status: 'success',
        groups: [
          {
            id: 'g',
            label: 'Models',
            buckets: [{ id: 'b', label: 'Weekly', remainingFraction: 0.6 }],
          },
        ],
      })[0].remaining
    ).toBe(60);
    expect(
      quotaWindows('meta', {
        status: 'success',
        data: { windows: [{ id: 'weekly', usedPercent: 15, resetAt: 1234 }] },
      })[0]
    ).toMatchObject({ remaining: 85, resetAtMs: 1234000 });
  });

  test('does not turn a zero Kimi limit or xAI health response into percentage quota', () => {
    const kimi: KimiQuotaState = {
      status: 'success',
      rows: [{ id: 'zero', label: 'Weekly', used: 0, limit: 0 }],
    };
    expect(quotaWindows('kimi', kimi)[0].remaining).toBeNull();
    const xai = {
      status: 'success',
      billing: { mode: 'paid-health', periodType: 'weekly', usagePercent: null },
    } as XaiQuotaState;
    expect(quotaWindows('xai', xai)).toEqual([]);
  });
});
