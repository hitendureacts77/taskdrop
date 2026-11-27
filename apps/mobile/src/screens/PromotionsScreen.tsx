import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, Switch } from 'react-native';
import { Screen, cardSurface } from '../components/ui';
import { LoadFailed, Shimmer, TopBar } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme, PersonTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { PromotePicker } from '../components/PromotePicker';
import { listPromotions, promotionResults, setPromoAlerts, type Promotion, type PromotionResults } from '../data/api';
import { messageOf, reportError } from '../lib/errors';
import { moneyText, promoState, type PromoState } from '../lib/promoteText';

/** What a row says about itself before (or without) its results: waiting, live or ended. */
function stateOf(p: Promotion, r: PromotionResults | undefined): PromoState {
  if (r) return promoState(r);
  return p.status === 'pending' ? 'waiting' : p.status === 'active' ? 'live' : 'ended';
}

const STATE_WORDS: Record<PromoState, string> = {
  waiting: 'WAITING FOR PAYMENT',
  empty: 'LIVE',
  live: 'LIVE',
  paused: 'PAUSED TODAY',
  ended: 'ENDED',
};

/**
 * The one Promotions screen: pick a task to promote at the top, and below it every promotion the person has
 * bought, current and past (tap one to open its results).
 */
export function PromotionsScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { mode } = useMode();
  const { flash } = useActions();
  const [rows, setRows] = useState<Promotion[] | null>(null);
  const [results, setResults] = useState<Record<string, PromotionResults>>({});
  const [failed, setFailed] = useState(false);
  // No getter for this switch yet, so it starts on (the default) and shows what was last set here.
  const [alertsOn, setAlertsOn] = useState(true);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const list = await listPromotions();
      setRows(list);
      // The top-show counts and "paused today" come from each one's results; they fill in as they arrive.
      for (const p of list) {
        if (p.status === 'pending') continue;
        void promotionResults(p.id)
          .then((r) => setResults((cur) => ({ ...cur, [p.id]: r })))
          .catch((e) => reportError(e, 'promotions-row'));
      }
    } catch (e) {
      reportError(e, 'promotions');
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggleAlerts = async (on: boolean) => {
    setAlertsOn(on);
    try {
      await setPromoAlerts(on);
    } catch (e) {
      setAlertsOn(!on);
      flash(messageOf(e, 'Could not change that'));
    }
  };

  const sorted = [...(rows ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const worker = mode === 'worker';

  return (
    <Screen scroll padded={false} onRefresh={() => void load()}>
      <TopBar title="Promotions" onBack={back} />
      <View style={{ paddingHorizontal: 20, paddingBottom: 30 }}>
        <PersonTheme role={worker ? 'worker' : 'poster'}>
          {sectionLabel(t, worker ? 'PROMOTE A SERVICE' : 'PROMOTE A TASK')}
          <PromotePicker
            kind={worker ? 'service' : 'request'}
            onPick={(p) => go('promote', { taskId: p.id })}
            onPost={() => go('create')}
          />
        </PersonTheme>

        <View style={{ marginTop: 26 }}>{sectionLabel(t, 'YOUR PROMOTIONS')}</View>
        {failed && !rows ? (
          <LoadFailed title="Couldn’t load your promotions" onRetry={() => void load()} />
        ) : !rows ? (
          <View style={{ gap: 12, marginTop: 16 }}>
            <Shimmer height={64} />
            <Shimmer height={64} />
          </View>
        ) : sorted.length === 0 ? (
          <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>
            Nothing yet. A promotion you start shows up here with how it did.
          </RNText>
        ) : (
          sorted.map((p) => (
            <PromotionRow key={p.id} p={p} r={results[p.id]} onOpen={() => go('promote', { taskId: p.task_id, results: true })} />
          ))
        )}

        {worker ? (
          <View style={{ ...cardSurface(t, 16), padding: 14, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <RNText style={tx('700', 14, t.colors.ink)}>Promoted task alerts</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })}>
                Alerts when someone promotes a task near you. At most 3 a day, never at night.
              </RNText>
            </View>
            <Switch
              value={alertsOn}
              onValueChange={(v) => void toggleAlerts(v)}
              trackColor={{ true: t.colors.accent, false: t.colors.line }}
              thumbColor={t.colors.surface}
              accessibilityLabel="Promoted task alerts"
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function sectionLabel(t: ReturnType<typeof useTheme>, text: string) {
  return <RNText style={tx('800', 11, t.colors.muted, { letterSpacing: 1.3, marginTop: 14, marginBottom: 10 })}>{text}</RNText>;
}

/** Tasks in jade and services in blue, so a person who does both can tell them apart. */
function PromotionRow({ p, r, onOpen }: { p: Promotion; r: PromotionResults | undefined; onOpen: () => void }) {
  const service = p.task?.kind === 'service';
  return (
    <PersonTheme role={service ? 'worker' : 'poster'}>
      <RowBody p={p} r={r} service={service} onOpen={onOpen} />
    </PersonTheme>
  );
}

function RowBody({ p, r, service, onOpen }: { p: Promotion; r: PromotionResults | undefined; service: boolean; onOpen: () => void }) {
  const t = useTheme();
  const state = stateOf(p, r);
  const spent = r?.spentMinor ?? p.spent_minor ?? 0;
  const running = state === 'live' || state === 'empty' || state === 'paused';
  const parts = [
    service ? 'Service' : 'Task',
    running ? `${moneyText(spent)} of ${moneyText(p.amount_minor)}` : `${moneyText(spent)} spent`,
    r ? `${r.topShows.toLocaleString('en-IN')} top shows` : '',
  ].filter(Boolean);
  const bg = state === 'paused' ? t.colors.goldSoft : state === 'ended' || state === 'waiting' ? t.colors.surface2 : t.colors.accentSoft;
  const fg = state === 'paused' ? t.colors.goldInk : state === 'ended' || state === 'waiting' ? t.colors.muted : t.colors.accentDeep;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${p.task?.title ?? 'Your post'}, ${STATE_WORDS[state].toLowerCase()}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.line,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>
          {p.task?.title ?? 'Your post'}
        </RNText>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
          {parts.join(' · ')}
        </RNText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
        {state === 'ended' || state === 'waiting' ? null : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />}
        <RNText style={tx('800', 10, fg, { letterSpacing: 1.1 })}>{STATE_WORDS[state]}</RNText>
      </View>
    </Pressable>
  );
}
