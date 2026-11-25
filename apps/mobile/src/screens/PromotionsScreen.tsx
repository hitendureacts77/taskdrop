import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, Switch } from 'react-native';
import { Screen, cardSurface, formatINR } from '../components/ui';
import { EmptyState, LoadFailed, Shimmer, TopBar } from '../components/kit';
import { PromotionResultsCard } from '../components/PromotionResultsCard';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { listPromotions, setPromoAlerts, type Promotion } from '../data/api';
import { messageOf, reportError } from '../lib/errors';
import { daysLabel, whenText } from '../lib/promoteText';

const STATUS_WORDS: Record<Promotion['status'], string> = {
  pending: 'Waiting for payment',
  active: 'Live',
  expired: 'Ended',
  cancelled: 'Stopped',
};

/** Every promotion the person has bought: tap one to open its results. */
export function PromotionsScreen() {
  const t = useTheme();
  const { back } = useNav();
  const { mode } = useMode();
  const { flash } = useActions();
  const [rows, setRows] = useState<Promotion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // No getter for this switch yet, so it starts on (the default) and shows what was last set here.
  const [alertsOn, setAlertsOn] = useState(true);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setRows(await listPromotions());
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

  return (
    <Screen scroll padded={false} onRefresh={() => void load()}>
      <TopBar title="Promotions" onBack={back} />
      <View style={{ paddingHorizontal: 20, paddingBottom: 30 }}>
        {mode === 'worker' ? (
          <View style={{ ...cardSurface(t, 16), padding: 14, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <RNText style={tx('700', 14, t.colors.ink)}>Promoted task alerts</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })}>
                One alert when someone nearby promotes a task. At most 3 a day, never at night.
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

        {failed && !rows ? (
          <LoadFailed title="Couldn’t load your promotions" onRetry={() => void load()} />
        ) : !rows ? (
          <View style={{ gap: 12, marginTop: 16 }}>
            <Shimmer height={72} />
            <Shimmer height={72} />
          </View>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon="bolt"
            title="No promotions yet"
            body="Promote a task or a service and its results show up here."
          />
        ) : (
          sorted.map((p) => {
            const open = openId === p.id;
            const service = p.task?.kind === 'service';
            const price = formatINR(p.amount_minor);
            const when = p.starts_at ? `${whenText(p.starts_at)}` : 'Not started';
            return (
              <View key={p.id} style={{ marginTop: 12 }}>
                <Pressable
                  onPress={() => setOpenId(open ? null : p.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  style={({ pressed }) => ({ ...cardSurface(t, 16), padding: 14, opacity: pressed ? 0.8 : 1 })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <RNText style={tx('700', 15, t.colors.ink, { flex: 1 })} numberOfLines={1}>
                      {p.task?.title ?? 'Your post'}
                    </RNText>
                    <RNText style={tx('700', 12, p.status === 'active' ? t.colors.accentDeep : t.colors.muted)}>
                      {STATUS_WORDS[p.status]}
                    </RNText>
                  </View>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
                    {daysLabel(p.days)} · {price} · {when}
                  </RNText>
                </Pressable>
                {open ? (
                  <View style={{ marginTop: 8 }}>
                    <PromotionResultsCard promotionId={p.id} service={service} onChanged={() => void load()} />
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </Screen>
  );
}
