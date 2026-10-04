import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import {
  buildResetDisplay,
  normalizePlanType,
  PREMIUM_CODEX_PLAN_TYPES,
  resolveQuotaErrorMessage,
} from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { quotaWindows } from '../summary';
import styles from './QuotaLedgerRow.module.scss';

export interface QuotaLedgerRowProps {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  details?: ReactNode;
}

export function QuotaLedgerRow({
  entry,
  quota,
  canRefresh,
  resetting,
  onRefresh,
  details,
}: QuotaLedgerRowProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const status = quota?.status ?? 'idle';
  const windows = quotaWindows(entry.type, quota);
  const name = getQuotaDisplayName(entry.file);
  // All remaining provider-specific metadata and reset actions stay in the
  // existing adapter body, available through Details in every ledger row.
  const metadata = quota as
    | (QuotaCardState & {
        planType?: string | null;
        plan?: string | null;
        subscription?: { tierName?: string | null; plan?: string | null } | null;
        data?: { planName?: string };
        billing?: { planLabel?: string } | null;
      })
    | undefined;
  let plan: string | null | undefined;
  if (status === 'success') {
    if (entry.type === 'claude' && metadata?.planType) {
      plan = t(`claude_quota.${metadata.planType}`, { defaultValue: metadata.planType });
    } else if (entry.type === 'codex' && metadata?.planType) {
      const normalized = normalizePlanType(metadata.planType);
      const key =
        normalized === 'self_serve_business_prolite'
          ? 'business_premium'
          : normalized !== 'pro' && PREMIUM_CODEX_PLAN_TYPES.has(normalized ?? '')
            ? 'prolite'
            : normalized;
      plan = t(`codex_quota.plan_${key}`, { defaultValue: metadata.planType });
    } else {
      plan =
        metadata?.plan ??
        metadata?.subscription?.tierName ??
        metadata?.subscription?.plan ??
        metadata?.data?.planName ??
        metadata?.billing?.planLabel;
    }
  }

  return (
    <article className={styles.account}>
      <div className={styles.row}>
        <header className={styles.identity}>
          <h3 title={name}>{name}</h3>
          <span>
            {getTypeLabel(t, entry.type)}
            {plan ? ` · ${plan}` : ''}
          </span>
        </header>
        <div className={styles.windows} aria-busy={status === 'loading'}>
          {status === 'error' ? (
            <div className={styles.error} role="alert">
              {resolveQuotaErrorMessage(
                t,
                quota?.errorStatus,
                quota?.error || t('common.unknown_error')
              )}
            </div>
          ) : windows.length > 0 ? (
            windows.map((window) => {
              const label = window.labelKey
                ? t(window.labelKey, window.labelParams ?? {})
                : window.label;
              const reset = buildResetDisplay(
                window.resetLabel,
                window.resetAtMs,
                now,
                i18n.resolvedLanguage
              );
              const remaining = window.remaining;
              return (
                <div className={styles.window} key={`${window.id}:${window.periodHours ?? ''}`}>
                  <div className={styles.windowHead}>
                    <span title={label}>{label}</span>
                    <strong>{remaining === null ? '--' : `${Math.round(remaining)}%`}</strong>
                  </div>
                  <div
                    className={`${styles.bar} ${remaining === null ? styles.unknown : ''}`}
                    role={remaining === null ? undefined : 'meter'}
                    aria-label={label}
                    aria-valuemin={remaining === null ? undefined : 0}
                    aria-valuemax={remaining === null ? undefined : 100}
                    aria-valuenow={remaining ?? undefined}
                  >
                    {remaining !== null && (
                      <span
                        style={{ width: `${remaining}%` }}
                        className={
                          remaining >= 70
                            ? styles.high
                            : remaining >= 30
                              ? styles.medium
                              : styles.low
                        }
                      />
                    )}
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
            })
          ) : (
            <span className={styles.message}>
              {t(
                status === 'loading'
                  ? 'quota_management.ledger_loading'
                  : status === 'idle'
                    ? 'quota_management.ledger_idle'
                    : 'quota_management.summary_no_data'
              )}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, status === 'loading', resetting)}
          >
            <IconRefreshCw size={13} aria-hidden="true" />
            {t('auth_files.quota_refresh_single')}
          </button>
        </div>
      </div>
      {details && (
        <details className={styles.details}>
          <summary>{t('quota_management.ledger_details')}</summary>
          <div className={styles.detailBody}>{details}</div>
        </details>
      )}
    </article>
  );
}
