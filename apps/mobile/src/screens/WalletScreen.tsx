import React, { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Animated, ScrollView, Linking } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { getWallet, getEscrowHeld, createPaymentLink, syncPayment } from '../data/api';
import { Pressy, tx } from '../components/primitives';

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
  const [busy, setBusy] = useState(false);
  const [topUpId, setTopUpId] = useState<string | null>(null);
  const [live, setLive] = useState<{ balance: number; escrow: number; clearing: number } | null>(null);

  // Real wallet for the signed-in user; the in-memory figures are the fallback
  // until it loads (or when signed out).
  useEffect(() => {
    let alive = true;
    Promise.all([getWallet(), getEscrowHeld()])
      .then(([w, held]) => {
        if (!alive || !w) return;
        setLive({ balance: w.balance_minor, escrow: held, clearing: w.clearing_minor });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Top-up: open a Razorpay link, then settle it when they come back.
  const topUp = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (topUpId) {
        const status = await syncPayment(topUpId);
        if (status !== 'paid') {
          flash('We have not seen that payment yet');
          return;
        }
        const w = await getWallet();
        if (w) setLive((p) => ({ ...(p ?? { escrow: 0, clearing: 0, balance: 0 }), balance: w.balance_minor, clearing: w.clearing_minor }));
        setTopUpId(null);
        celebrate('Funds added');
        return;
      }
      const { paymentId, url } = await createPaymentLink({ purpose: 'topup', amountMinor: 100000 });
      setTopUpId(paymentId);
      await Linking.openURL(url);
      flash('Finish the payment, then tap “I’ve paid”');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not start the payment');
    } finally {
      setBusy(false);
    }
  };

  const shown = live ?? { balance, escrow, clearing };
  const worker = mode === 'worker';
  const total = Math.max(1, shown.balance + shown.escrow + shown.clearing);
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%` as `${number}%`;

  const ledger = [
    {
      title: 'Payout received',
      meta: 'Fix leaking kitchen tap · cleared',
      amt: `+${formatINR(360000)}`,
      dot: t.colors.accent,
      ink: t.colors.accentDeep,
    },
    {
      title: 'Held in escrow',
      meta: 'Vintage film camera · task started',
      amt: formatINR(463500),
      dot: t.colors.gold,
      ink: t.colors.ink,
    },
    {
      title: 'Clearing',
      meta: 'Assemble a wardrobe · 3 days left',
      amt: formatINR(360000),
      dot: t.colors.blue,
      ink: t.colors.ink,
    },
  ];

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.72 })}>Wallet</RNText>

        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 22 })}>
          {worker ? 'Available to withdraw' : 'Wallet balance'}
        </RNText>
        <RNText
          style={tx('800', 44, t.colors.ink, { letterSpacing: -1.76, lineHeight: 48.4, marginTop: 4 })}
        >
          {formatINR(shown.balance)}
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
          <RNText style={tx('700', 15, t.colors.onAccent)}>Withdraw {formatINR(shown.balance)}</RNText>
        </Pressy>

        {/* Money in, via Razorpay. Opens a payment link, then settles on return. */}
        <Pressy
          onPress={topUp}
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
            {topUpId ? 'I’ve paid — check now' : busy ? 'Working…' : 'Add funds'}
          </RNText>
        </Pressy>

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>
          RECENT
        </RNText>

        {ledger.map((l, i) => (
          <SlideIn key={l.title} delay={i * 70}>
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
              <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: l.dot }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText style={tx('600', 15, t.colors.ink)}>{l.title}</RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>{l.meta}</RNText>
              </View>
              <RNText style={tx('700', 15, l.ink)}>{l.amt}</RNText>
            </View>
          </SlideIn>
        ))}
      </ScrollView>
    </Screen>
  );
}
