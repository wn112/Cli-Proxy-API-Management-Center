import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { ProviderQuotaSummary, QuotaWindowSummary } from '../summary';
import styles from './QuotaOverview.module.scss';

export function QuotaOverview({
  summaries,
  resolvedTheme,
}: {
  summaries: ProviderQuotaSummary[];
  resolvedTheme: ResolvedTheme;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  if (summaries.length === 0) return null;

  const windowLabel = (window: QuotaWindowSummary) =>
    window.labelKey ? t(window.labelKey, window.labelParams ?? {}) : window.label;

  const renderWindow = (window: QuotaWindowSummary, accountCount: number) => {
    const reset = buildResetDisplay(null, window.nextResetAtMs, now, i18n.resolvedLanguage);
    return (
      <div className={styles.window} key={window.key}>
        <div className={styles.windowLabel}>{windowLabel(window)}</div>
        <div className={styles.total}>
          <strong>{window.remaining === null ? '--' : `${Math.round(window.remaining)}%`}</strong>
          {window.knownCount > 0 && (
            <span>{t('quota_management.summary_of', { capacity: window.capacity })}</span>
          )}
        </div>
        <div className={styles.segments} aria-hidden="true">
          {window.segments.map((segment) => (
            <div
              key={segment.key}
              className={`${styles.segment} ${segment.remaining === null ? styles.unknown : ''}`}
              title={`${segment.name}: ${segment.remaining === null ? t('quota_management.summary_unknown') : `${Math.round(segment.remaining)}%`}`}
            >
              {segment.remaining !== null && (
                <span
                  style={{ width: `${segment.remaining}%` }}
                  className={
                    segment.remaining >= 70
                      ? styles.high
                      : segment.remaining >= 30
                        ? styles.medium
                        : styles.low
                  }
                />
              )}
            </div>
          ))}
        </div>
        <div className={styles.coverage}>
          {t('quota_management.summary_coverage', {
            known: window.knownCount,
            total: accountCount,
          })}
        </div>
        <div className={styles.reset}>
          {reset ? (
            <>
              <span>{reset.relative}</span>
              <span>{reset.absolute}</span>
            </>
          ) : (
            t('quota_management.summary_reset_unknown')
          )}
        </div>
      </div>
    );
  };

  return (
    <section aria-label={t('quota_management.summary_title')}>
      <div className={styles.overview}>
        {summaries.map((summary) => {
          const icon = getAuthFileIcon(summary.provider, resolvedTheme);
          const [primary, ...others] = summary.windows;
          return (
            <article className={styles.provider} key={summary.provider}>
              <header className={styles.header}>
                <h2>
                  {icon && <img src={icon} alt="" />}
                  {getTypeLabel(t, summary.provider)}
                </h2>
                <span>
                  {t('quota_management.meta_credentials', { count: summary.accountCount })}
                </span>
              </header>
              {primary ? (
                renderWindow(primary, summary.accountCount)
              ) : (
                <div className={styles.noData}>
                  <strong>--</strong>
                  <span>{t('quota_management.summary_no_data')}</span>
                </div>
              )}
              {(summary.unqueriedCount > 0 ||
                summary.errorCount > 0 ||
                summary.loadingCount > 0) && (
                <div className={styles.status}>
                  {summary.unqueriedCount > 0 && (
                    <span>
                      {t('quota_management.summary_unqueried', { count: summary.unqueriedCount })}
                    </span>
                  )}
                  {summary.loadingCount > 0 && (
                    <span>
                      {t('quota_management.summary_loading', { count: summary.loadingCount })}
                    </span>
                  )}
                  {summary.errorCount > 0 && (
                    <span className={styles.failure}>
                      {t('quota_management.summary_failed', { count: summary.errorCount })}
                    </span>
                  )}
                </div>
              )}
              {others.length > 0 && (
                <details className={styles.more}>
                  <summary>{t('quota_management.summary_more', { count: others.length })}</summary>
                  {others.map((window) => renderWindow(window, summary.accountCount))}
                </details>
              )}
            </article>
          );
        })}
      </div>
      <p className={styles.note}>{t('quota_management.summary_note')}</p>
    </section>
  );
}
