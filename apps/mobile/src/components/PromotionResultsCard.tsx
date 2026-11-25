import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { cardSurface } from './ui';
import { Icon } from './Icon';
import { LoadFailed, Shimmer } from './kit';
import { tx } from './primitives';
import { useTheme, PersonTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { reportError } from '../lib/errors';
import { listPromotions, promotionResults, type Promotion, type PromotionResults } from '../data/api';
import {
  agoText,
  alertedText,
  costPerOfferMinor,
  daysLabel,
  endText,
  moneyText,
  promoState,
  ranLongerText,
  runsUntilText,
  spanText,
  surfaceBars,
  timeLeftText,
  type PromoState,
} from '../lib/promoteText';

/**
 * What a promotion bought, in numbers the payer can read. Always the poster's jade for a task and the
 * Earn blue for a service (PersonTheme swaps the accent tokens whatever mode the screen is in).
 * A paid promotion runs to the end: there is no stop button here.
 */
export function PromotionResultsCard({
  promotionId,
  service,
  onPromoteAgain,
}: {
  promotionId: string;
  service: boolean;
  /** Called by "Promote again" on an ended promotion; by default it opens the Promote screen for the task. */
  onPromoteAgain?: () => void;
}) {
  return (
    <PersonTheme role={service ? 'worker' : 'poster'}>
      <CardBody promotionId={promotionId} service={service} onPromoteAgain={onPromoteAgain} />
    </PersonTheme>
  );
}

function CardBody({ promotionId, service, onPromoteAgain }: { promotionId: string; service: boolean; onPromoteAgain?: () => void }) {
  const t = useTheme();
  const { go } = useNav();
  const [r, setR] = useState<PromotionResults | null>(null);
  const [failed, setFailed] = useState(false);

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

  const state = promoState(r);
  const bars = surfaceBars(r.bySurface, service);
  const post = service ? 'service' : 'task';
  const endIso = r.lastEndAt ?? r.endsAt;
  const cost = costPerOfferMinor(r.spentMinor, r.offersSince);
  const spentPct = r.amountMinor > 0 ? Math.min(100, Math.round((r.spentMinor / r.amountMinor) * 100)) : 0;

  const pill = (s: PromoState) => {
    const words = s === 'paused' ? 'PAUSED TODAY' : s === 'ended' ? 'ENDED' : s === 'waiting' ? 'WAITING FOR PAYMENT' : 'LIVE';
    const bg = s === 'paused' ? t.colors.goldSoft : s === 'ended' ? t.colors.surface2 : t.colors.accentSoft;
    const fg = s === 'paused' ? t.colors.goldInk : s === 'ended' ? t.colors.muted : t.colors.accentDeep;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
        {s === 'ended' ? null : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />}
        <RNText style={tx('800', 10, fg, { letterSpacing: 1.1 })}>{words}</RNText>
      </View>
    );
  };

  const sideText =
    state === 'ended'
      ? [`ran ${spanText(r.startsAt, endIso)}`.trim(), endIso ? `ended ${endText(endIso)}` : ''].filter((x) => x !== 'ran').join(' · ')
      : state === 'empty'
        ? [r.startsAt ? `started ${agoText(r.startsAt)}` : '', daysLabel(r.days)].filter(Boolean).join(' · ')
        : state === 'waiting'
          ? ''
          : timeLeftText(endIso);

  const tile = (big: number, caption: string) => (
    <View key={caption} style={{ width: '48%', flexGrow: 1, borderWidth: 1, borderColor: t.colors.line, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10 }}>
      <RNText style={tx('800', 19, t.colors.ink)}>{big.toLocaleString('en-IN')}</RNText>
      <RNText style={tx('400', 11, t.colors.muted, { marginTop: 1, lineHeight: 15 })}>{caption}</RNText>
    </View>
  );

  const kv = (k: string, v: string, key?: string) => (
    <View key={key ?? k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 3 }}>
      <RNText style={tx('400', 12, t.colors.muted, { flexShrink: 1 })}>{k}</RNText>
      <RNText style={tx('700', 12, t.colors.ink, { textAlign: 'right', flexShrink: 1 })}>{v}</RNText>
    </View>
  );

  const meter = (pct: number) => (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surface2, overflow: 'hidden', marginVertical: 4 }}>
      <View style={{ width: `${pct}%`, height: 8, backgroundColor: t.colors.accent }} />
    </View>
  );

  const box = (title: string, body: string, tone: 'accent' | 'gold' = 'accent') => (
    <View
      style={{
        marginTop: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: tone === 'gold' ? t.colors.gold : t.colors.accentBorder,
        backgroundColor: tone === 'gold' ? t.colors.goldSoft : t.colors.accentSoft,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <RNText style={tx('400', 12, t.colors.ink, { lineHeight: 17 })}>
        <RNText style={tx('800', 12, tone === 'gold' ? t.colors.goldInk : t.colors.accentDeep)}>{title} </RNText>
        {body}
      </RNText>
    </View>
  );

  const tiles = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      {tile(r.onTop, service ? 'customers saw you on top' : 'saw it on top')}
      {state === 'paused' ? null : tile(r.saw, service ? 'customers saw you' : 'saw it anywhere')}
      {tile(r.opened, service ? 'opened your profile' : 'opened it')}
      {state === 'paused'
        ? null
        : tile(r.offersSince, service ? 'asked you' : `offers (${r.offersBefore} before)`)}
    </View>
  );

  const priceLine = r.avgPriceMinor !== null && r.avgPriceMinor !== undefined ? (
    <View style={{ marginTop: 6 }}>
      {kv(
        state === 'ended' ? 'Average price per top show' : 'Your price per top show',
        `${moneyText(r.avgPriceMinor)}${state !== 'ended' && r.areaPriceMinor ? ` · others here ${moneyText(r.areaPriceMinor)}` : ''}`,
      )}
    </View>
  ) : null;

  const barsBlock =
    bars.length > 0 && state !== 'paused' && state !== 'ended' ? (
      <View style={{ marginTop: 12 }}>
        <RNText style={tx('800', 10, t.colors.muted, { letterSpacing: 1.2 })}>{service ? 'WHERE THEY SAW YOU' : 'WHERE THEY SAW IT'}</RNText>
        {bars.map((b) => (
          <View key={b.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 }}>
            <RNText style={tx('500', 12, t.colors.text, { width: 72 })}>{b.label}</RNText>
            <View style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: t.colors.surface2 }}>
              <View style={{ width: `${b.pct}%`, height: 7, borderRadius: 4, backgroundColor: t.colors.accent }} />
            </View>
            <RNText style={tx('700', 12, t.colors.ink, { minWidth: 34, textAlign: 'right' })}>{b.pct}%</RNText>
          </View>
        ))}
      </View>
    ) : null;

  const spentBlock = (
    <View style={{ marginTop: 12 }}>
      {kv('Spent so far', `${moneyText(r.spentMinor)} of ${moneyText(r.amountMinor)}`)}
      {meter(spentPct)}
      {state === 'live' ? kv('Today', `${moneyText(r.todaySpentMinor)} of ${moneyText(r.todayBudgetMinor)}`) : null}
    </View>
  );

  return (
    <View style={{ ...cardSurface(t, 18), padding: 15, borderColor: t.colors.accentBorder }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {pill(state)}
        {sideText ? <RNText style={tx('500', 11, t.colors.muted, { flexShrink: 1, textAlign: 'right' })}>{sideText}</RNText> : null}
      </View>

      {state === 'waiting' ? (
        box('Waiting for payment.', 'It goes live as soon as the payment arrives. Nothing is shown to anyone before that.')
      ) : null}

      {state === 'empty' ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 8 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="clock" size={24} color={t.colors.accentDeep} strokeWidth={2} />
          </View>
          <RNText style={tx('800', 15, t.colors.ink)}>No top shows yet</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', lineHeight: 17 })}>
            {service
              ? 'Your service joins the next auction when a customer nearby opens the helpers list. The first shows usually come within 15 minutes.'
              : 'Your task joins the next auction when a worker nearby opens Find work. The first shows usually come within 15 minutes.'}
          </RNText>
          {!service && alertedText(r.alerted) ? (
            <RNText style={tx('400', 12, t.colors.text, { textAlign: 'center', marginTop: 6 })}>{alertedText(r.alerted)}</RNText>
          ) : null}
        </View>
      ) : null}

      {state === 'paused'
        ? box(
            `Today's ${moneyText(r.dayBudgetMinor)} is used up.`,
            `Your ${post} shows on top again tomorrow. It still has the Promoted label on the map until then.`,
            'gold',
          )
        : null}

      {state === 'ended' ? (
        <View
          style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentSoft, padding: 12 }}
        >
          <RNText style={tx('800', 10, t.colors.accentDeep, { letterSpacing: 1.2 })}>MONEY</RNText>
          <RNText style={tx('800', 20, t.colors.ink, { marginTop: 2 })}>
            {moneyText(r.spentMinor)} spent of {moneyText(r.amountMinor)}
          </RNText>
          {ranLongerText(r.endsAt, r.lastEndAt) ? (
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3, lineHeight: 15 })}>{ranLongerText(r.endsAt, r.lastEndAt)}</RNText>
          ) : null}
        </View>
      ) : null}

      {state === 'live' || state === 'paused' ? spentBlock : null}
      {state === 'empty' || state === 'waiting' ? null : tiles}
      {state === 'live' ? priceLine : null}
      {barsBlock}
      {state === 'ended' ? (
        <View style={{ marginTop: 6 }}>
          {priceLine}
          {!service && cost !== null ? kv('Cost per offer', moneyText(cost)) : null}
          {service && cost !== null ? kv('Cost per request', moneyText(cost)) : null}
        </View>
      ) : null}

      {state === 'ended' ? (
        <Pressable
          onPress={() => (onPromoteAgain ? onPromoteAgain() : go('promote', { taskId: r.taskId }))}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 14,
            backgroundColor: t.colors.btn,
            borderRadius: 999,
            minHeight: 44,
            justifyContent: 'center',
            alignItems: 'center',
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <RNText style={tx('700', 14, t.colors.onBtn)}>Promote again</RNText>
        </Pressable>
      ) : state === 'waiting' ? null : (
        <RNText style={tx('400', 11, t.colors.muted, { textAlign: 'center', marginTop: 14, lineHeight: 16 })}>{runsUntilText(endIso)}</RNText>
      )}
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
      <PromotionResultsCard promotionId={promo.id} service={service || promo.task?.kind === 'service'} />
    </View>
  );
}
