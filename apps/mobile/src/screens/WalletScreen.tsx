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

  // Each side sees its own money: a worker what they earned and withdrew, a
  // poster what they spent and added. Setting the two against each other
  // produced a "net" that read as a loss for anyone who only ever hires.
  const mine = useMemo(
    () =>
      ledger.filter((l) =>
        worker ? l.kind === 'clearing' || l.kind === 'payout' : l.kind === 'escrow' || l.kind === 'released' || l.kind === 'topup',
      ),
    [ledger, worker],
  );
  const inPeriod = useMemo(
    () => mine.filter((l) => !since || new Date(l.at).getTime() >= since.getTime()),
    [mine, since],
  );

  // Weekly buckets (monthly for all time), in rupees.
  const flow = useMemo<FlowPoint[]>(() => {
    const start = since ?? (mine.length ? new Date(mine[mine.length - 1]!.at) : new Date());
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
      // Earnings for a worker, spending (not top-ups) for a poster.
      if (worker ? l.kind !== 'clearing' : l.kind === 'topup') continue;
      const at = new Date(l.at);
      const i = monthly
        ? (at.getFullYear() - start.getFullYear()) * 12 + at.getMonth() - start.getMonth()
        : Math.floor((at.getTime() - start.getTime()) / (7 * 86400000));
      const b = buckets[Math.max(0, Math.min(buckets.length - 1, i))]!;
      if (worker) b.income += l.amountMinor / 100;
      else b.expense += l.amountMinor / 100;
    }
    return buckets;
  }, [inPeriod, mine, since, worker]);

  const periodTotal = inPeriod
    .filter((l) => (worker ? l.kind === 'clearing' : l.kind === 'escrow' || l.kind === 'released'))
    .reduce((n, l) => n + l.amountMinor, 0);
  const held = ledger.filter((l) => l.kind === 'escrow');

  const TX_TABS = worker ? ['All', 'Earnings', 'Withdrawals'] : ['All', 'Spending', 'Money added'];
  const [txTab, setTxTab] = useState(0);
  useEffect(() => setTxTab(0), [worker]);
  const txRows = inPeriod.filter((l) => {
    if (txTab === 0) return true;
    if (worker) return txTab === 1 ? l.kind === 'clearing' : l.kind === 'payout';
    return txTab === 1 ? l.kind === 'escrow' || l.kind === 'released' : l.kind === 'topup';
  });

  const shareCode = async () => {
    if (!code) return;
    const message = `I use TaskDrop to get things done and earn nearby. Sign up with my code ${code}.`;
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
    k === 'escrow' ? t.colors.gold : k === 'clearing' ? t.colors.blue : k === 'payout' ? t.colors.purple : t.colors.accent;

  const chartColor = worker ? t.colors.purple : t.colors.accent;
  const feeMinor = fees ? (worker ? fees.commissionMinor : fees.serviceMinor) : null;

  return (
    <Screen padded={false}>
      <AppHeader />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />}
      >
        {/* The money that matters to this side, big, with the part that is
            not spendable yet beside it. */}
        <View
          style={{
            backgroundColor: worker ? t.colors.purpleDeep : t.colors.accentDeep,
            borderRadius: 20,
            padding: 18,
          }}
        >
          <RNText style={tx('600', 13, 'rgba(255,255,255,0.8)')}>
            {worker ? 'Ready to withdraw' : 'Wallet balance'}
          </RNText>
          <RNText style={tx('800', 40, '#FFFFFF', { letterSpacing: -1.4, marginTop: 4 })}>
            {loaded ? formatINR(shown.balance) : '—'}
          </RNText>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, padding: 10 }}>
              <RNText style={tx('500', 11, 'rgba(255,255,255,0.8)')}>
                {worker ? `Clearing · ${7} days` : 'Held in escrow'}
              </RNText>
              <RNText style={tx('800', 16, '#FFFFFF', { marginTop: 3 })}>
                {formatINR(worker ? shown.clearing : shown.escrow)}
              </RNText>
            </View>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, padding: 10 }}>
              <RNText style={tx('500', 11, 'rgba(255,255,255,0.8)')}>
                {worker ? 'Earned' : 'Spent'} · {period.toLowerCase()}
              </RNText>
              <RNText style={tx('800', 16, '#FFFFFF', { marginTop: 3 })}>{formatINR(periodTotal)}</RNText>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          {worker ? (
            <Pressy
              onPress={() => go('withdraw')}
              style={{ flex: 1, backgroundColor: t.colors.purpleDeep, borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}
            >
              <RNText style={tx('700', 15, '#FFFFFF')}>Withdraw</RNText>
            </Pressy>
          ) : (
            <>
              <Pressy
                onPress={() => setAddingFunds(true)}
                style={{ flex: 1, backgroundColor: t.colors.accent, borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}
              >
                <RNText style={tx('700', 15, t.colors.onAccent)}>Add money</RNText>
              </Pressy>
              {shown.balance > 0 ? (
                <Pressy
                  onPress={() => go('withdraw')}
                  style={{ flex: 1, borderWidth: 1, borderColor: t.colors.line, borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}
                >
                  <RNText style={tx('700', 15, t.colors.ink)}>Withdraw</RNText>
                </Pressy>
              ) : null}
            </>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 20, marginHorizontal: -20 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
            {PERIODS.map((p) => (
              <Pill key={p} label={p} active={period === p} onPress={() => setPeriod(p)} />
            ))}
          </View>
        </ScrollView>

        <View style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="trending" size={16} color={chartColor} />
            <RNText style={tx('800', 14, t.colors.ink, { flex: 1 })}>{worker ? 'Your earnings' : 'Your spending'}</RNText>
            <RNText style={tx('800', 14, chartColor)}>{formatINR(periodTotal)}</RNText>
          </View>
          <View style={{ marginTop: 12 }}>
            {periodTotal > 0 ? (
              <MoneyFlowChart points={flow} only={worker ? 'income' : 'expense'} color={chartColor} />
            ) : (
              <RNText style={tx('400', 12, t.colors.muted, { paddingVertical: 18, textAlign: 'center' })}>
                {worker ? 'Nothing earned in this period yet.' : 'Nothing spent in this period.'}
              </RNText>
            )}
          </View>
        </View>

        {/* Pending money is a poster's concern: it is theirs, held until they
            approve the work. */}
        {!worker && held.length > 0 ? (
          <View style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="lock" size={16} color={t.colors.gold} />
              <RNText style={tx('800', 14, t.colors.ink, { flex: 1 })}>Waiting for your approval</RNText>
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

        <View style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="tag" size={16} color={t.colors.goldInk} />
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 13, t.colors.ink)}>
              {worker ? 'Commission paid' : 'Service fees paid'} · {period.toLowerCase()}
            </RNText>
            <Pressable onPress={() => go('pricing')} accessibilityRole="button">
              <RNText style={tx('600', 12, t.colors.accentDeep, { marginTop: 2 })}>How fees work ›</RNText>
            </Pressable>
          </View>
          <RNText style={tx('800', 14, t.colors.ink)}>{feeMinor === null ? '–' : formatINR(feeMinor)}</RNText>
        </View>

        <SectionTitle title="Transactions" icon="list" style={{ marginTop: 24 }} />
        <View style={{ marginTop: 8, marginHorizontal: -20 }}>
          <UnderlineTabs tabs={TX_TABS} active={txTab} onPick={setTxTab} />
        </View>

        {!ledgerLoading && txRows.length === 0 && (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 14, lineHeight: 20 })}>
            {mine.length === 0
              ? worker
                ? 'Finish a job and your earnings show up here.'
                : 'Hire someone and what you pay shows up here.'
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

        {code ? (
          <View style={{ ...card, marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="gift" size={20} color={t.colors.accentDeep} />
            <View style={{ flex: 1 }}>
              <RNText style={tx('700', 13, t.colors.ink)}>Bring a friend to TaskDrop</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                Your code {code} · {joined} joined so far
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
