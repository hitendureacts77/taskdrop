import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { getWallet, getProfile, updateProfile, requestWithdrawal } from '../data/api';
import { useAuth } from '../providers/AuthProvider';
import { Pressy, tx } from '../components/primitives';

export function WithdrawScreen() {
  const t = useTheme();
  const { go, back } = useNav();
  const { balance, roll, celebrate, flash } = useApp();
  const { userId } = useAuth();

  // Start from the real wallet balance, not whatever the animated counter holds.
  const [availableMinor, setAvailableMinor] = useState(balance);
  const [rupees, setRupees] = useState(Math.floor(balance / 100));
  const [busy, setBusy] = useState(false);
  const [upi, setUpi] = useState<string | null>(null);
  const [upiDraft, setUpiDraft] = useState('');
  const [editingUpi, setEditingUpi] = useState(false);

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
        setRupees(Math.floor(w.balance_minor / 100));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
      roll('balance', left);
      celebrate(`${formatINR(amountMinor)} on its way`);
      go('wallet');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not start that withdrawal');
    } finally {
      setBusy(false);
    }
  };

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
          <Pressable onPress={() => setRupees(Math.floor(availableMinor / 100))} hitSlop={8}>
            <RNText style={tx('600', 12, t.colors.accentDeep)}>Withdraw all</RNText>
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
