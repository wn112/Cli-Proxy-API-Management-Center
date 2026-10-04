import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { ClaudeQuotaState } from '@/types';
import { buildProviderSummaries } from '@/features/quota/summary';
import { QuotaOverview } from '@/features/quota/components/QuotaOverview';
import { QuotaLedgerRow } from '@/features/quota/components/QuotaLedgerRow';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
const entry = { type: 'claude' as const, file: { name: 'personal.json', type: 'claude' } };
const quota: ClaudeQuotaState = {
  status: 'success',
  planType: 'plan_max',
  windows: [
    { id: 'seven-day', label: '7-day limit', usedPercent: 25, resetLabel: '', periodHours: 168 },
  ],
};

describe('quota console', () => {
  test('names the observed coverage alongside a partial total', () => {
    const summaries = buildProviderSummaries(
      [entry, { ...entry, file: { ...entry.file, name: 'unknown.json' } }],
      (item) => (item.file.name === 'personal.json' ? quota : undefined)
    );
    const html = renderToStaticMarkup(
      createElement(QuotaOverview, { summaries, resolvedTheme: 'dark' })
    );
    expect(html).toContain('75%');
    expect(html).toContain('of 100%');
    expect(html).toContain('1 of 2 accounts reported');
    expect(html).toContain('1 not queried');
    expect(html).not.toContain('of 200%');
  });

  test('unqueried accounts provide no invented percentage or model label', () => {
    const summaries = buildProviderSummaries([entry], () => undefined);
    const html = renderToStaticMarkup(
      createElement(QuotaOverview, { summaries, resolvedTheme: 'dark' })
    );
    expect(html).toContain('No quota reported');
    expect(html).not.toContain('<strong>100%</strong>');
    expect(html).not.toContain('Fable');
  });

  test('ledger preserves reported plan, remaining percentage and the detail affordance', () => {
    const html = renderToStaticMarkup(
      createElement(QuotaLedgerRow, {
        entry,
        quota,
        canRefresh: true,
        resetting: false,
        onRefresh: () => {},
        details: createElement('p', null, 'Full account details'),
      })
    );
    expect(html).toContain('personal.json');
    expect(html).toContain('Max');
    expect(html).toContain('75%');
    expect(html).toContain('Reset not reported');
    expect(html).toContain('<details');
    expect(html).toContain('Full account details');
    expect(html).toContain('Refresh quota');
  });

  test('loading and reset in progress disable ledger refresh', () => {
    for (const props of [
      { quota: { status: 'loading' as const }, resetting: false },
      { quota, resetting: true },
    ]) {
      const html = renderToStaticMarkup(
        createElement(QuotaLedgerRow, { entry, ...props, canRefresh: true, onRefresh: () => {} })
      );
      expect(html).toMatch(/<button[^>]*disabled=""/);
    }
  });

  test.each(['en', 'zh-CN', 'zh-TW', 'ru'])('resolves console copy in %s', async (language) => {
    await i18n.changeLanguage(language);
    try {
      const summaries = buildProviderSummaries([entry], () => undefined);
      const html = renderToStaticMarkup(
        createElement(QuotaOverview, { summaries, resolvedTheme: 'dark' })
      );
      expect(html).not.toContain('quota_management.');
      expect(i18n.exists('quota_management.console_connect', { lng: language })).toBe(true);
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
