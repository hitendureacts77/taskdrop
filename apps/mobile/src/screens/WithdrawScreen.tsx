import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import {
  getWallet,
  getProfile,
  updateProfile,
  requestWithdrawal,
  listPayouts,
  cancelWithdrawal,
  type Payout,
} from '../data/api';
import { PayoutList } from '../components/PayoutList';
import { useAuth } from '../providers/AuthProvider';
import { Pressy, tx } from '../components/primitives';

export function WithdrawScreen() {
  const t = useTheme();
  const { back } = useNav();
  const { balance, roll, celebrate, flash } = useApp();
  const { userId } = useAuth();

  // Start from the real wallet balance, not whatever the animated counter holds.
  const [availableMinor, setAvailableMinor] = useState(balance);
  const [rupees, setRupees] = useState(Math.floor(balance / 100));
  const [busy, setBusy] = useState(false);
  const [upi, setUpi] = useState<string | null>(null);
  const [upiDraft, setUpiDraft] = useState('');
  const [editingUpi, setEditingUpi] = useState(false);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loadingPayouts, setLoadingPayouts] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const startEditUpi = () => {
    setUpiDraft(upi ?? '');
    setEditingUpi(true);
  };

  const saveUpi = async () => {
    const next = upiDraft.trim();
    // Matches the check constraint on profiles, so the error arrives here
    // rather than as a database failure.
    if (!/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$/.test(next)) {
      flash('That does not look like a UPI id — try yourname@bank');
      return;
    }
    if (!userId) return;
    try {
      await updateProfile(userId, { payoutUpi: next });
      setUpi(next);
      setEditingUpi(false);
      flash('Payout account saved');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save that');
    }
  };

  /**
   * Re-read the wallet and the queue together. They are two halves of one
   * number — showing a refreshed balance beside a stale payout list is how
   * someone ends up thinking their money vanished.
   */
  const refresh = useCallback(async () => {
    const [wallet, rows] = await Promise.allSettled([getWallet(), listPayouts()]);
    if (wallet.status === 'fulfilled' && wallet.value) {
      setAvailableMinor(wallet.value.balance_minor);
    }
    if (rows.status === 'fulfilled') setPayouts(rows.value);
    setLoadingPayouts(false);
  }, []);

  useEffect(() => {
    let alive = true;
    if (userId) {
      getProfile(userId)
        .then((me) => alive && setUpi(me?.payout_upi ?? null))
        .catch(() => {});
    }
    getWallet()
      .then((w) => {
        if (!alive || !w) return;
        setAvailableMinor(w.balance_minor);
        // Pre-fill the amount once, from the real balance. After that it is
        // the user's number and must not be overwritten by a refresh.
        setRupees(Math.floor(w.balance_minor / 100));
      })
      .catch(() => {});
    void refresh();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const amountMinor = rupees * 100;
  const overdrawn = amountMinor > availableMinor;
  const empty = amountMinor <= 0;

  const rows: { label: string; value: string; strong: boolean }[] = [
    { label: 'Available', value: formatINR(availableMinor), strong: false },
    { label: 'Transfer fee', value: 'Free', strong: false },
    { label: 'You receive', value: formatINR(empty || overdrawn ? 0 : amountMinor), strong: true },
  ];

  const doWithdraw = async () => {
    if (busy) return;
    if (empty) {
      flash('Enter an amount to withdraw');
      return;
    }
    if (overdrawn) {
      flash(`You only have ${formatINR(availableMinor)} available`);
      return;
    }
    if (!upi) {
      flash('Add the UPI id your money should go to first');
      startEditUpi();
      return;
    }
    setBusy(true);
    try {
      await requestWithdrawal(amountMinor, upi);
      const left = availableMinor - amountMinor;
      setAvailableMinor(left);
      setRupees(0);
      roll('balance', left);
      celebrate(`${formatINR(amountMinor)} requested`);
      // Stay put. The whole point of the queue below is that you can see the
      // request you just made — and change your mind about it.
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not start that withdrawal');
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async (payout: Payout) => {
    if (cancellingId) return;
    setCancellingId(payout.id);
    try {
      await cancelWithdrawal(payout.id);
      const back = availableMinor + payout.amount_minor;
      setAvailableMinor(back);
      roll('balance', back);
      celebrate(`${formatINR(payout.amount_minor)} back in your wallet`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not cancel that withdrawal');
    } finally {
      setCancellingId(null);
      // Either way the server is the truth about what the queue looks like now.
      await refresh();
    }
  };

  // Money that has left the wallet but has not arrived anywhere yet. Without
  // this the two numbers do not add up and it looks like money went missing.
  const inFlightMinor = payouts
    .filter((p) => p.status === 'requested' || p.status === 'processing')
    .reduce((sum, p) => sum + p.amount_minor, 0);

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={back} hitSlop={10}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <RNText style={tx('700', 17, t.colors.ink)}>Withdraw</RNText>
        </View>

        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 24 })}>Amount</RNText>
        <AmountField
          rupees={rupees}
          onChangeRupees={(r) => setRupees(r ?? 0)}
          align="left"
          style={tx('800', 44, overdrawn ? t.colors.signal : t.colors.ink, {
            letterSpacing: -1.76,
            lineHeight: 46.2,
            marginTop: 4,
          })}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <RNText style={tx('400', 12, overdrawn ? t.colors.signal : t.colors.muted, { flex: 1 })}>
            {overdrawn
              ? `Only ${formatINR(availableMinor)} available.`
              : 'Arrives in 1 working day.'}
          </RNText>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          {[50000, 100000, 250000].map((minor) => (
            <Pressable
              key={minor}
              onPress={() => setRupees(minor / 100)}
              disabled={minor > availableMinor}
              accessibilityRole="button"
              accessibilityLabel={`Withdraw ${formatINR(minor)}`}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.colors.line,
                backgroundColor: t.colors.surface,
                opacity: minor > availableMinor ? 0.35 : 1,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <RNText style={tx('700', 12, t.colors.ink)}>{formatINR(minor)}</RNText>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setRupees(Math.floor(availableMinor / 100))}
            disabled={availableMinor <= 0}
            accessibilityRole="button"
            accessibilityLabel="Withdraw the whole balance"
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.colors.accent,
              backgroundColor: t.colors.accentSoft,
              opacity: availableMinor <= 0 ? 0.35 : 1,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <RNText style={tx('700', 12, t.colors.accentDeep)}>All</RNText>
          </Pressable>
        </View>

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 24 })}>TO</RNText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 13,
            marginTop: 11,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: t.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('800', 14, t.colors.accentDeep)}>UPI</RNText>
          </View>
          <View style={{ flex: 1 }}>
            {editingUpi ? (
              <TextInput
                value={upiDraft}
                onChangeText={setUpiDraft}
                onSubmitEditing={() => void saveUpi()}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                placeholder="yourname@bank"
                placeholderTextColor={t.colors.muted}
                style={tx('700', 15, t.colors.ink, { padding: 0 })}
              />
            ) : (
              <RNText style={tx('700', 15, upi ? t.colors.ink : t.colors.muted)}>
                {upi ?? 'No payout account yet'}
              </RNText>
            )}
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
              {upi ? 'Where your money is sent' : 'Add the UPI id your money should go to'}
            </RNText>
          </View>
          <Pressable
            onPress={() => (editingUpi ? void saveUpi() : startEditUpi())}
            hitSlop={8}
            accessibilityRole="button"
          >
            <RNText style={tx('600', 13, t.colors.accentDeep)}>
              {editingUpi ? 'Save' : upi ? 'Change' : 'Add'}
            </RNText>
          </Pressable>
        </View>

        <View style={{ marginTop: 18 }}>
          {rows.map((r) => (
            <View
              key={r.label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
              }}
            >
              <RNText style={tx('400', 14, r.strong ? t.colors.ink : t.colors.muted)}>{r.label}</RNText>
              <RNText style={tx(r.strong ? '800' : '600', 14, t.colors.ink)}>{r.value}</RNText>
            </View>
          ))}
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginTop: 26,
          }}
        >
          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>
            YOUR WITHDRAWALS
          </RNText>
          {inFlightMinor > 0 && (
            <RNText style={tx('600', 12, t.colors.muted)}>
              {formatINR(inFlightMinor)} on its way
            </RNText>
          )}
        </View>

        <PayoutList
          payouts={payouts}
          loading={loadingPayouts}
          cancellingId={cancellingId}
          onCancel={(p) => void doCancel(p)}
        />

        <View style={{ height: 20 }} />
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressy
          onPress={doWithdraw}
          style={{
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: empty || overdrawn ? 0.5 : 1,
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>
            {busy ? 'Sending…' : `Withdraw ${formatINR(amountMinor)}`}
          </RNText>
        </Pressy>
      </View>
    </Screen>
  );
}
