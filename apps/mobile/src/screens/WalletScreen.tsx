import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Animated, ScrollView, RefreshControl, Pressable, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  getProfile,
  getWallet,
  getEscrowHeld,
  listWalletActivity,
  settleClearedEarnings,
  type WalletEvent,
} from '../data/api';
import { Pressy, tx } from '../components/primitives';
import { AddFundsSheet } from '../components/AddFundsSheet';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { Pill, SectionTitle, UnderlineTabs } from '../components/kit';
import { MoneyFlowChart, type FlowPoint } from '../components/MoneyFlowChart';
import { countMyReferrals, feesSince, platformFees } from '../data/extras';

/** Staggered row entrance, ~ the markup's tdIn keyframe with animation-delay. */
function SlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: 340, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [v, delay]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

export function WalletScreen() {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();
  const { balance, escrow, clearing, flash, celebrate } = useApp();
  const { userId } = useAuth();
  const [live, setLive] = useState<{ balance: number; escrow: number; clearing: number } | null>(null);

  // Real wallet for the signed-in user; the in-memory figures are the fallback
  // until it loads (or when signed out).
  useEffect(() => {
    let alive = true;
    // Sweep first. Earnings that finished clearing are spendable, and reading
    // the wallet before moving them shows them as still clearing -- which on
    // this screen reads as "my money is stuck".
    settleClearedEarnings()
      .catch(() => {})
      .then(() => Promise.all([getWallet(), getEscrowHeld()]))
      .then(([w, held]) => {
        if (!alive || !w) return;
        setLive({ balance: w.balance_minor, escrow: held, clearing: w.clearing_minor });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Adding money lives in its own sheet: it has to ask how much, and it has
  // to watch for the payment rather than asking whether it arrived.
  const [addingFunds, setAddingFunds] = useState(false);

  const onFunded = async (amountMinor: number) => {
    setAddingFunds(false);
    try {
      const w = await getWallet();
      if (w) {
        setLive((p) => ({
          ...(p ?? { escrow: 0, clearing: 0, balance: 0 }),
          balance: w.balance_minor,
          clearing: w.clearing_minor,
        }));
      }
    } catch {
      /* the celebrate below is still true; the figure refreshes on next load */
    }
    celebrate(`${formatINR(amountMinor)} added`);
  };

  // Never substitute local state for the server's answer: this is the screen
  // that tells someone how much money they have, and a plausible wrong number
  // is worse here than an honest blank.
  const shown = live ?? { balance, escrow, clearing };
  const loaded = live !== null;
  const worker = mode === 'worker';
  const total = Math.max(1, shown.balance + shown.escrow + shown.clearing);
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%` as `${number}%`;

  // Real money events for this account. Nothing here is illustrative: the
  // previous three rows showed a payout and an escrow hold that never existed.
  const [ledger, setLedger] = useState<WalletEvent[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (!userId) return;
    setRefreshing(true);
    try {
      await settleClearedEarnings().catch(() => {});
      const [w, held, rows] = await Promise.all([
        getWallet(),
        getEscrowHeld(),
        listWalletActivity(userId, 200),
      ]);
      if (w) setLive({ balance: w.balance_minor, clearing: w.clearing_minor, escrow: held });
      setLedger(rows);
    } catch {
      /* keep what is on screen */
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!userId) {
      setLedgerLoading(false);
      return;
    }
    let alive = true;
    listWalletActivity(userId, 200)
      .then((rows) => alive && setLedger(rows))
      .catch(() => alive && setLedger([]))
      .finally(() => alive && setLedgerLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  // ---- period, referral and fees -------------------------------------------
  const PERIODS = ['This month', 'Last 30 days', 'All time'] as const;
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('This month');
  const since = useMemo(() => {
    const now = new Date();
    if (period === 'This month') return new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === 'Last 30 days') return new Date(now.getTime() - 30 * 86400000);
    return null;
  }, [period]);

  const [code, setCode] = useState<string | null>(null);
  const [joined, setJoined] = useState(0);
  const [fees, setFees] = useState<{ serviceMinor: number; commissionMinor: number } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void getProfile(userId).then((p) => alive && setCode(p?.referral_code ?? null)).catch(() => {});
    void countMyReferrals().then((n) => alive && setJoined(n));
    return () => {
      alive = false;
    };
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void platformFees()
      .then((f) => feesSince(since, f.commission))
      .then((r) => alive && setFees(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, since]);

  const inPeriod = useMemo(
    () => ledger.filter((l) => !since || new Date(l.at).getTime() >= since.getTime()),
    [ledger, since],
  );

  // Weekly buckets (monthly for all time) of money in and out, in rupees.
  const flow = useMemo<FlowPoint[]>(() => {
    const start = since ?? (ledger.length ? new Date(ledger[ledger.length - 1]!.at) : new Date());
    const monthly = !since;
    const buckets: FlowPoint[] = [];
    const cursor = new Date(start);
    const end = new Date();
    let guard = 0;
    while (cursor <= end && guard++ < 24) {
      buckets.push({
        label: cursor.toLocaleDateString('en-IN', monthly ? { month: 'short' } : { day: 'numeric', month: 'short' }),
        income: 0,
        expense: 0,
      });
      if (monthly) cursor.setMonth(cursor.getMonth() + 1);
      else cursor.setDate(cursor.getDate() + 7);
    }
    if (buckets.length === 0) return [];
    for (const l of inPeriod) {
      const at = new Date(l.at);
      const i = monthly
        ? (at.getFullYear() - start.getFullYear()) * 12 + at.getMonth() - start.getMonth()
        : Math.floor((at.getTime() - start.getTime()) / (7 * 86400000));
      const b = buckets[Math.max(0, Math.min(buckets.length - 1, i))]!;
      if (l.incoming) b.income += l.amountMinor / 100;
      else b.expense += l.amountMinor / 100;
    }
    return buckets;
  }, [inPeriod, ledger, since]);
  const totalIn = inPeriod.filter((l) => l.incoming).reduce((n, l) => n + l.amountMinor, 0);
  const totalOut = inPeriod.filter((l) => !l.incoming).reduce((n, l) => n + l.amountMinor, 0);
  const held = ledger.filter((l) => l.kind === 'escrow');

  const TX_TABS = ['All', 'Earnings', 'Spending', 'Withdrawals'];
  const [txTab, setTxTab] = useState(0);
  const txRows = inPeriod.filter((l) =>
    txTab === 1 ? l.kind === 'clearing' : txTab === 2 ? l.kind === 'escrow' || l.kind === 'released' : txTab === 3 ? l.kind === 'payout' : true,
  );

  const shareCode = async () => {
    if (!code) return;
    const message = `Join me on TaskDrop — get things done or earn nearby. Use my code ${code} when you sign up.`;
    try {
      await Share.share({ message });
    } catch {
      await Clipboard.setStringAsync(message);
      flash('Invite copied');
    }
  };

  const card = {
    marginTop: 16,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.line,
    borderRadius: 14,
    padding: 14,
  } as const;

  const dotFor = (k: WalletEvent['kind']) =>
    k === 'escrow' ? t.colors.gold : k === 'clearing' ? t.colors.blue : t.colors.accent;

  return (
    <Screen padded={false}>
      <AppHeader />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />
        }
      >
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.72 })}>Wallet</RNText>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
          Money you can use for tasks, or withdraw as earnings
        </RNText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -20 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
            {PERIODS.map((p) => (
              <Pill key={p} label={p} active={period === p} onPress={() => setPeriod(p)} />
            ))}
          </View>
        </ScrollView>

        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 22 })}>
          {worker ? 'Available to withdraw' : 'Wallet balance'}
        </RNText>
        <RNText
          style={tx('800', 44, t.colors.ink, { letterSpacing: -1.76, lineHeight: 48.4, marginTop: 4 })}
        >
          {loaded ? formatINR(shown.balance) : '—'}
        </RNText>

        {/* Segmented available / escrow / clearing bar */}
        <View
          style={{
            flexDirection: 'row',
            height: 7,
            borderRadius: 999,
            overflow: 'hidden',
            backgroundColor: t.colors.surface2,
            marginTop: 18,
          }}
        >
          <View style={{ width: pct(shown.balance), backgroundColor: t.colors.accent }} />
          <View style={{ width: pct(shown.escrow), backgroundColor: t.colors.gold }} />
          <View style={{ width: pct(shown.clearing), backgroundColor: t.colors.blue }} />
        </View>

        <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
          <RNText style={tx('400', 11, t.colors.accentDeep)}>● Available</RNText>
          <RNText style={tx('400', 11, t.colors.gold)}>● In escrow</RNText>
          <RNText style={tx('400', 11, t.colors.blue)}>● Clearing</RNText>
        </View>

        {/* Two-column stat strip */}
        <View
          style={{
            flexDirection: 'row',
            marginTop: 20,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: t.colors.line,
          }}
        >
          <View style={{ flex: 1, paddingVertical: 15, borderRightWidth: 1, borderRightColor: t.colors.line }}>
            <RNText style={tx('400', 11, t.colors.gold)}>In escrow</RNText>
            <RNText style={tx('800', 19, t.colors.ink, { marginTop: 5 })}>{formatINR(shown.escrow)}</RNText>
          </View>
          <View style={{ flex: 1, paddingVertical: 15, paddingLeft: 16 }}>
            <RNText style={tx('400', 11, t.colors.blue)}>Clearing · 7d</RNText>
            <RNText style={tx('800', 19, t.colors.ink, { marginTop: 5 })}>{formatINR(shown.clearing)}</RNText>
          </View>
        </View>

        <Pressy
          onPress={() => go('withdraw')}
          style={{
            marginTop: 22,
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 15,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}
        >
          <RNText style={tx('700', 15, t.colors.onAccent)}>
            {loaded ? `Withdraw ${formatINR(shown.balance)}` : 'Withdraw'}
          </RNText>
        </Pressy>

        {/* Money in, via Razorpay. Opens a payment link, then settles on return. */}
        <Pressy
          onPress={() => setAddingFunds(true)}
          style={{
            marginTop: 10,
            borderRadius: 999,
            paddingVertical: 15,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: t.colors.line,
          }}
        >
          <RNText style={tx('700', 15, t.colors.ink)}>
            Add money
          </RNText>
        </Pressy>

        {/* Invite friends. Records who joined with the code; see migration 048. */}
        {code ? (
          <View style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentSoft }}>
            <Icon name="gift" size={22} color={t.colors.accentDeep} />
            <View style={{ flex: 1 }}>
              <RNText style={tx('700', 14, t.colors.ink)}>Invite friends</RNText>
              <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 2 })}>
                Code {code} · {joined} joined
              </RNText>
            </View>
            <Pressable
              onPress={() => void Clipboard.setStringAsync(code).then(() => flash('Code copied'))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Copy referral code"
            >
              <Icon name="copy" size={19} color={t.colors.accentDeep} />
            </Pressable>
            <Pressable onPress={() => void shareCode()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Share invite">
              <Icon name="share" size={19} color={t.colors.accentDeep} />
            </Pressable>
          </View>
        ) : null}

        <View style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="tag" size={16} color={t.colors.goldInk} />
            <RNText style={tx('800', 14, t.colors.ink, { flex: 1 })}>Platform fees · {period.toLowerCase()}</RNText>
            <RNText style={tx('700', 12, t.colors.goldInk)}>
              {fees ? formatINR(fees.serviceMinor + fees.commissionMinor) : '–'}
            </RNText>
          </View>
          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            {[
              ['Commission paid', fees ? formatINR(fees.commissionMinor) : '–'],
              ['Service fees paid', fees ? formatINR(fees.serviceMinor) : '–'],
              ['Payout fees', formatINR(0)],
            ].map(([k, v]) => (
              <View key={k} style={{ flex: 1 }}>
                <RNText style={tx('400', 11, t.colors.muted)}>{k}</RNText>
                <RNText style={tx('700', 14, t.colors.ink, { marginTop: 4 })}>{v}</RNText>
              </View>
            ))}
          </View>
          <Pressable onPress={() => go('pricing')} style={{ marginTop: 10 }} accessibilityRole="button">
            <RNText style={tx('700', 12, t.colors.accentDeep)}>How fees work ›</RNText>
          </Pressable>
        </View>

        <View style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="trending" size={16} color={t.colors.accentDeep} />
            <RNText style={tx('800', 14, t.colors.ink, { flex: 1 })}>Money flow</RNText>
            <RNText style={tx('600', 11, t.colors.accentDeep)}>● In</RNText>
            <RNText style={tx('600', 11, t.colors.signal)}>● Out</RNText>
          </View>
          <View style={{ marginTop: 12 }}>
            {flow.length > 0 ? (
              <MoneyFlowChart points={flow} />
            ) : (
              <RNText style={tx('400', 12, t.colors.muted)}>No money moved in this period.</RNText>
            )}
          </View>
          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <RNText style={tx('400', 11, t.colors.muted)}>Net this period</RNText>
              <RNText style={tx('800', 16, totalIn - totalOut >= 0 ? t.colors.accentDeep : t.colors.signal, { marginTop: 3 })}>
                {totalIn - totalOut >= 0 ? '+' : '−'}
                {formatINR(Math.abs(totalIn - totalOut))}
              </RNText>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <RNText style={tx('400', 11, t.colors.muted)}>In / out</RNText>
              <RNText style={tx('700', 13, t.colors.ink, { marginTop: 3 })}>
                {formatINR(totalIn)} / {formatINR(totalOut)}
              </RNText>
            </View>
          </View>
        </View>

        {held.length > 0 ? (
          <View style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="lock" size={16} color={t.colors.gold} />
              <RNText style={tx('800', 14, t.colors.ink, { flex: 1 })}>Money in escrow</RNText>
              <RNText style={tx('600', 11, t.colors.goldInk)}>
                {held.length} task{held.length === 1 ? '' : 's'}
              </RNText>
            </View>
            {held.map((h) => (
              <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                <RNText style={tx('500', 13, t.colors.ink, { flex: 1 })} numberOfLines={1}>
                  {h.meta.split(' · ')[0]}
                </RNText>
                <RNText style={tx('700', 13, t.colors.goldInk)}>{formatINR(h.amountMinor)}</RNText>
              </View>
            ))}
          </View>
        ) : null}

        <SectionTitle title="Transactions" icon="list" style={{ marginTop: 24 }} />
        <View style={{ marginTop: 8, marginHorizontal: -20 }}>
          <UnderlineTabs tabs={TX_TABS} active={txTab} onPick={setTxTab} />
        </View>

        {!ledgerLoading && txRows.length === 0 && (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 14, lineHeight: 20 })}>
            {ledger.length === 0
              ? worker
                ? 'Finish a task and your earnings show up here.'
                : 'Post a task and the money you put in escrow shows up here.'
              : 'Nothing of this kind in this period.'}
          </RNText>
        )}

        {txRows.map((l, i) => (
          <SlideIn key={l.id} delay={Math.min(i, 8) * 50}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 15,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
              }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: dotFor(l.kind) }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText style={tx('600', 15, t.colors.ink)} numberOfLines={1}>
                  {l.title}
                </RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                  {new Date(l.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {l.meta}
                </RNText>
              </View>
              <RNText style={tx('700', 15, l.incoming ? t.colors.accentDeep : t.colors.ink)}>
                {l.incoming ? '+' : ''}
                {formatINR(l.amountMinor)}
              </RNText>
            </View>
          </SlideIn>
        ))}
      </ScrollView>

      <AddFundsSheet
        visible={addingFunds}
        onClose={() => setAddingFunds(false)}
        onFunded={(minor: number) => void onFunded(minor)}
        flash={flash}
      />
    </Screen>
  );
}
