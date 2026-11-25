import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { cardSurface } from './ui';
import { ConfirmDialog, LoadFailed, Shimmer } from './kit';
import { tx } from './primitives';
import { useTheme, PersonTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { reportError, messageOf } from '../lib/errors';
import { cancelPromotion, listPromotions, promotionResults, type Promotion, type PromotionResults } from '../data/api';
import { surfaceBars, timeLeftText } from '../lib/promoteText';

/**
 * What a promotion bought, in numbers the payer can read. Always the poster's jade for a task and the
 * Earn blue for a service (PersonTheme swaps the accent tokens whatever mode the screen is in).
 */
export function PromotionResultsCard({
  promotionId,
  service,
  onChanged,
}: {
  promotionId: string;
  service: boolean;
  /** Called after Stop promotion, so the screen around the card can refetch. */
  onChanged?: () => void;
}) {
  return (
    <PersonTheme role={service ? 'worker' : 'poster'}>
      <CardBody promotionId={promotionId} service={service} onChanged={onChanged} />
    </PersonTheme>
  );
}

function CardBody({ promotionId, service, onChanged }: { promotionId: string; service: boolean; onChanged?: () => void }) {
  const t = useTheme();
  const { go } = useNav();
  const { flash } = useActions();
  const [r, setR] = useState<PromotionResults | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setR(await promotionResults(promotionId));
    } catch (e) {
      reportError(e, 'promotion-results');
      setFailed(true);
    }
  }, [promotionId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (failed && !r) return <LoadFailed title="Couldn’t load the results" onRetry={() => void load()} />;
  if (!r) return <Shimmer height={220} />;

  const live = r.status === 'active';
  const waiting = r.status === 'pending';
  const badge = live ? 'PROMOTED · LIVE' : waiting ? 'PROMOTED · WAITING FOR PAYMENT' : 'PROMOTED · ENDED';
  const bars = surfaceBars(r.bySurface, service);

  const stop = async () => {
    setBusy(true);
    try {
      await cancelPromotion(r.promotionId);
      setConfirm(false);
      flash('Promotion stopped');
      await load();
      onChanged?.();
    } catch (e) {
      flash(messageOf(e, 'Could not stop that promotion'));
    } finally {
      setBusy(false);
    }
  };

  const tile = (big: number, caption: string) => (
    <View
      key={caption}
      style={{ width: '48%', flexGrow: 1, backgroundColor: t.colors.accentSoft, borderRadius: 12, padding: 12 }}
    >
      <RNText style={tx('800', 24, t.colors.ink)}>{big.toLocaleString('en-IN')}</RNText>
      <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 2, lineHeight: 17 })}>{caption}</RNText>
    </View>
  );

  return (
    <View style={{ ...cardSurface(t, 18), padding: 15, borderColor: t.colors.accentBorder }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ backgroundColor: t.colors.btn, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <RNText style={tx('700', 11, t.colors.onBtn, { letterSpacing: 0.8 })}>{badge}</RNText>
        </View>
        {live ? <RNText style={tx('600', 13, t.colors.accentDeep)}>{timeLeftText(r.endsAt)}</RNText> : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {tile(r.saw, 'saw it')}
        {tile(r.opened, 'opened it')}
        {service
          ? tile(r.onTop, 'saw it on top')
          : tile(r.offersSince, `offers since you promoted (${r.offersBefore} before)`)}
        {service ? null : tile(r.alerted, 'nearby workers got the alert')}
      </View>

      {bars.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>WHERE THEY SAW IT</RNText>
          {bars.map((b) => (
            <View key={b.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 }}>
              <RNText style={tx('500', 13, t.colors.text, { width: 78 })}>{b.label}</RNText>
              <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: t.colors.surface2 }}>
                <View style={{ width: `${b.pct}%`, height: 8, borderRadius: 4, backgroundColor: t.colors.accent }} />
              </View>
              <RNText style={tx('700', 13, t.colors.ink, { minWidth: 34, textAlign: 'right' })}>{b.count}</RNText>
            </View>
          ))}
        </View>
      ) : null}

      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 14, lineHeight: 17 })}>
        A person who saw it in two places counts once in “saw it”. Your own views never count.
      </RNText>

      {live || waiting ? (
        <Pressable
          onPress={() => setConfirm(true)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 14,
            borderWidth: 1,
            borderColor: t.colors.signal,
            borderRadius: 999,
            paddingVertical: 12,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <RNText style={tx('700', 14, t.colors.signalDeep)}>Stop promotion</RNText>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => go('promote', { taskId: r.taskId })}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 14,
            backgroundColor: t.colors.btn,
            borderRadius: 999,
            paddingVertical: 13,
            alignItems: 'center',
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <RNText style={tx('700', 14, t.colors.onBtn)}>Promote again</RNText>
        </Pressable>
      )}

      <ConfirmDialog
        visible={confirm}
        danger
        icon="close"
        title="Stop promotion?"
        message="Stop now? Unused full days come back to you."
        confirmLabel="Yes, stop it"
        cancelLabel="Keep it"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void stop()}
      />
    </View>
  );
}

/**
 * On a poster's own task page: the latest promotion of that task, if there is one. Shows nothing while
 * loading or when the task was never promoted, so the page does not jump for the many tasks that were not.
 */
export function TaskPromotionResults({ taskId, service = false }: { taskId: string; service?: boolean }) {
  const [promo, setPromo] = useState<Promotion | null>(null);
  const load = useCallback(() => {
    void listPromotions()
      .then((rows) => {
        const mine = rows
          .filter((p) => p.task_id === taskId && (p.status !== 'cancelled' || p.starts_at))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setPromo(mine[0] ?? null);
      })
      .catch((e) => reportError(e, 'task-promotion'));
  }, [taskId]);
  useEffect(load, [load]);
  if (!promo) return null;
  return (
    <View style={{ marginTop: 12 }}>
      <PromotionResultsCard promotionId={promo.id} service={service || promo.task?.kind === 'service'} onChanged={load} />
    </View>
  );
}
