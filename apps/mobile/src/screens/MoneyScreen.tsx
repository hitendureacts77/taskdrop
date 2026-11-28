import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, RefreshControl } from 'react-native';
import { Screen, formatINR, cardSurface } from '../components/ui';
import { AppHeader } from '../components/AppHeader';
import { TabTitle } from '../components/TabTitle';
import { useLayout } from '../lib/layout';
import { walletLine } from '../lib/tabLines';
import { GetPaidSheet } from '../components/GetPaidSheet';
import { Pressy, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, useFocusTick } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { reportError } from '../lib/errors';
import { getMoneyLedger, type MoneyLedger } from '../data/api';
import { useMoneyMode } from '../lib/useMoneyMode';
import { ledgerIncoming, ledgerLabel, payeeCard } from '../lib/moneyText';
import { useDesktopHeaderPortal } from '../components/pageHeader';
import { WeekEarningsChart } from '../components/WeekEarningsChart';

/** How many ledger rows the Wallet reads (the server caps at 300). */
const LEDGER_LIMIT = 100;

const WALLET_LINE = 'Each task is paid for on its own and held by Razorpay until the work is approved.';

/**
 * The Wallet tab under Plan B (pay per task). There is no balance, no top-up and no withdraw: each task is
 * paid for on its own and the payment company holds it. This is a record of paid, held, sent and refunded
 * money, read from the server (`my_money_ledger`). Palette follows the mode: jade when paying or holding,
 * royal blue when earning (the theme swaps the accent).
 */
export function MoneyScreen() {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();
  const focusTick = useFocusTick();
  const { mode: money, refresh: refreshMode } = useMoneyMode();
  const worker = mode === 'worker';
  const { desktop, scale } = useLayout();

  const [data, setData] = useState<MoneyLedger | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [getPaid, setGetPaid] = useState(false);

  const load = async () => {
    try {
      const l = await getMoneyLedger(LEDGER_LIMIT);
      setData(l);
      setFailed(false);
    } catch (e) {
      reportError(e, 'money');
      setFailed(true);
    }
  };

  useEffect(() => {
    void load();
  }, [focusTick]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshMode()]);
    setRefreshing(false);
  };

  const card = worker ? payeeCard(money?.payee ?? null) : null;
  const held = data ? (worker ? data.on_hold_for_me_minor : data.my_money_held_minor) : 0;
  const tiles: { label: string; minor: number }[] = [
    { label: 'Paid', minor: data?.totals.paid_minor ?? 0 },
    { label: 'On hold', minor: held },
    { label: 'Released', minor: data?.totals.released_minor ?? 0 },
    { label: 'Refunded', minor: data?.totals.refunded_minor ?? 0 },
  ];
  const rows = data?.rows ?? [];
  // Desktop: one title, "Wallet", with the sentence under it, in the page header (no second "Money" heading).
  const headerPortal = useDesktopHeaderPortal({ title: 'Wallet', subtitle: WALLET_LINE });
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const COLS = { date: { width: 130 }, task: { flex: 1.3, minWidth: 0 }, what: { flex: 1, minWidth: 0 }, amount: { width: 160 } } as const;

  return (
    <Screen padded={false}>
      {desktop ? headerPortal : null}
      <AppHeader />
      {desktop ? null : (
        <TabTitle
          title="Wallet"
          live={walletLine({ loaded: data !== null, held: formatINR(held), heldMinor: held })}
          action={
            <Pressy
              onPress={() => go('pricing')}
              label="How fees work"
              style={{ borderWidth: 1.5, borderColor: t.colors.accentBorder, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14 }}
            >
              <RNText style={tx('800', 13.5, t.colors.accentDeep)}>How fees work</RNText>
            </Pressy>
          }
        />
      )}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.accent} />}
      >
        {desktop ? null : (
          <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>{WALLET_LINE}</RNText>
        )}

        {card ? (
          <View style={{ ...cardSurface(t), marginTop: 16, padding: 16, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentSoft }}>
            <RNText style={tx('800', 15, t.colors.accentDeep)}>{card.title}</RNText>
            <RNText style={tx('400', 13, t.colors.ink, { marginTop: 5, lineHeight: 19 })}>{card.body}</RNText>
            {card.action ? (
              <Pressy
                onPress={() => setGetPaid(true)}
                style={{ marginTop: 12, backgroundColor: t.colors.btn, borderRadius: 999, paddingVertical: 12, alignItems: 'center' }}
              >
                <RNText style={tx('700', 14, t.colors.onAccent)}>{card.action}</RNText>
              </Pressy>
            ) : null}
          </View>
        ) : worker && money?.payee?.status === 'active' ? (
          <RNText style={tx('600', 12, t.colors.muted, { marginTop: 14 })}>
            Get paid is set up{money.payee.hint ? `: ${money.payee.hint}` : ''}.
          </RNText>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: desktop ? 'nowrap' : 'wrap', gap: desktop ? 12 : 10, marginTop: desktop ? 20 : 16 }}>
          {tiles.map((x) => (
            <View key={x.label} style={{ ...cardSurface(t, 16), flexBasis: desktop ? 0 : '47%', flexGrow: 1, minWidth: 0, padding: 14 }}>
              <RNText style={tx('600', 12, t.colors.muted)}>{x.label}</RNText>
              <RNText style={tx('800', 20, t.colors.ink, { marginTop: 4, fontVariant: ['tabular-nums'] })}>{formatINR(x.minor)}</RNText>
            </View>
          ))}
        </View>

        {worker && data ? <WeekEarningsChart rows={rows} full={rows.length >= LEDGER_LIMIT} /> : null}

        <RNText style={tx('800', 16, t.colors.ink, { marginTop: 24, marginBottom: desktop ? 12 : 6 })}>Your money, task by task</RNText>
        {failed && !data ? (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10 })}>Could not load this right now. Pull down to try again.</RNText>
        ) : data && rows.length === 0 ? (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10 })}>Nothing here yet. Money for each task shows up as it moves.</RNText>
        ) : desktop ? (
          // A table in a white card, styled like the My tasks table: grey head row, 52 px rows, money right-aligned.
          <View style={{ ...cardSurface(t, 16), overflow: 'hidden', marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: t.colors.surface2, borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
              <RNText style={[tx('700', 11, t.colors.muted, { letterSpacing: 1 }), COLS.date]}>DATE</RNText>
              <RNText style={[tx('700', 11, t.colors.muted, { letterSpacing: 1 }), COLS.task]}>TASK</RNText>
              <RNText style={[tx('700', 11, t.colors.muted, { letterSpacing: 1 }), COLS.what]}>WHAT HAPPENED</RNText>
              <RNText style={[tx('700', 11, t.colors.muted, { letterSpacing: 1, textAlign: 'right' }), COLS.amount]}>AMOUNT</RNText>
            </View>
            {rows.map((r, i) => (
              <Pressy
                key={`${r.created_at}-${r.kind}-${i}`}
                onPress={r.task_id ? () => go('taskManage', { taskId: r.task_id }) : undefined}
                scaleTo={0.995}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, minHeight: 53 / scale, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.colors.line }}
              >
                <RNText style={[tx('500', 13, t.colors.muted), COLS.date]} numberOfLines={1}>{dateOf(r.created_at)}</RNText>
                <RNText style={[tx('700', 14, t.colors.ink), COLS.task]} numberOfLines={1}>{r.task_title && r.kind !== 'paid' ? r.task_title : '–'}</RNText>
                <RNText style={[tx('400', 13.5, t.colors.text), COLS.what]} numberOfLines={1}>{ledgerLabel(r)}</RNText>
                <RNText
                  style={[tx('800', 14, ledgerIncoming(r.kind) ? t.colors.accentDeep : t.colors.ink, { fontVariant: ['tabular-nums'], textAlign: 'right' }), COLS.amount]}
                  numberOfLines={1}
                >
                  {ledgerIncoming(r.kind) ? '+' : ''}
                  {formatINR(r.amount_minor)}
                </RNText>
              </Pressy>
            ))}
          </View>
        ) : (
          rows.map((r, i) => (
            <Pressy
              key={`${r.created_at}-${r.kind}-${i}`}
              onPress={r.task_id ? () => go('taskManage', { taskId: r.task_id }) : undefined}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <RNText style={tx('600', 14, t.colors.ink)} numberOfLines={2}>
                  {ledgerLabel(r)}
                </RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                  {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {r.task_title && r.kind !== 'paid' ? ` · ${r.task_title}` : ''}
                </RNText>
              </View>
              <RNText style={tx('800', 14, ledgerIncoming(r.kind) ? t.colors.accentDeep : t.colors.ink, { fontVariant: ['tabular-nums'] })}>
                {ledgerIncoming(r.kind) ? '+' : ''}
                {formatINR(r.amount_minor)}
              </RNText>
            </Pressy>
          ))
        )}
      </ScrollView>

      <GetPaidSheet visible={getPaid} onClose={() => setGetPaid(false)} onDone={() => void refreshMode()} />
    </Screen>
  );
}
