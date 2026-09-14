import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
  ScrollView,
  Linking,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { createPaymentLink, syncPayment } from '../data/api';
import { posterEscrowCharge } from '@taskdrop/rules';
import { Pressy, tx } from '../components/primitives';

/** How often we ask the server whether the money has landed. */
const POLL_MS = 3000;
/** Stop after ~3 minutes; past that something is wrong and polling is noise. */
const POLL_LIMIT = 60;

/** Shield + checkmark icon copied from the markup (lines 821-824); the checkmark
 * draws in over ~0.7s like the markup's tdDraw keyframe. Cleans up on unmount. */
function ShieldCheck({ color }: { color: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: 1, duration: 700, delay: 150, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [progress]);
  const AnimatedPath = Animated.createAnimatedComponent(Path);
  const dashoffset = progress.interpolate({ inputRange: [0, 1], outputRange: [60, 0] });
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
      <AnimatedPath
        d="m9 12 2.2 2.2L15.5 10"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={60}
        strokeDashoffset={dashoffset as unknown as number}
      />
    </Svg>
  );
}

/**
 * Escrow funding step — pixel parity with docs/design/_design_markup.html lines
 * 802-839 (header, total, breakdown rows, safety note, pay methods, pay CTA).
 * Data/handlers mirror docs/design/_design_source.jsx lines 718-747. The poster
 * pays the locked quote + 3% fee into escrow before the worker starts; releasing
 * escrow later happens on ConfirmScreen.
 */
export function EscrowScreen() {
  const t = useTheme();
  const { params, go, back } = useNav();
  const { escrow, roll, celebrate, flash } = useApp();
  const [busy, setBusy] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [checks, setChecks] = useState(0);

  const taskId = typeof params.taskId === 'string' ? params.taskId : null;

  const title = typeof params.title === 'string' ? params.title : null;
  const who = typeof params.who === 'string' ? params.who : null;
  const by = typeof params.by === 'string' ? params.by : null;
  // No fallback price. This screen charges real money, and a default here
  // meant arriving without a quote showed a confident ₹4,635 bill for a task
  // that did not exist.
  const lockedMinor = typeof params.priceMinor === 'number' ? params.priceMinor : null;
  const feeMinor = lockedMinor === null ? 0 : posterEscrowCharge(lockedMinor) - lockedMinor;
  const totalMinor = lockedMinor === null ? 0 : lockedMinor + feeMinor;

  const rows: { label: string; value: string; strong: boolean }[] = [
    { label: who ? `Locked quote · ${who}` : 'Locked quote', value: formatINR(lockedMinor ?? 0), strong: false },
    { label: 'Poster fee · 3%', value: formatINR(feeMinor), strong: false },
    ...(by ? [{ label: 'Complete by', value: by, strong: false }] : []),
    { label: 'Total held', value: formatINR(totalMinor), strong: true },
  ];

  // Razorpay opens in the browser as a payment link, so the same flow works on
  // web and in Expo Go. We poll for settlement when the user comes back.
  const settled = useRef(false);

  /** One check. Returns true once the money is actually in. */
  const checkOnce = useCallback(
    async (id: string): Promise<boolean> => {
      const status = await syncPayment(id);
      if (status !== 'paid') return false;
      if (settled.current) return true;
      settled.current = true;
      roll('escrow', escrow + totalMinor);
      celebrate(`${formatINR(totalMinor)} held in escrow · locked`);
      go('orders');
      return true;
    },
    [escrow, go, roll, celebrate, totalMinor],
  );

  /**
   * Watch for the money instead of asking the payer to swear they sent it.
   *
   * The webhook settles the payment the moment Razorpay confirms it, so the
   * app's job is just to notice. Polling stops on its own after a few minutes:
   * past that the answer is not going to arrive by waiting, and a spinner that
   * never ends is worse than a button.
   */
  useEffect(() => {
    if (!waiting || !paymentId) return;
    let alive = true;
    const timer = setInterval(() => {
      if (!alive) return;
      setChecks((n) => n + 1);
      void checkOnce(paymentId).catch(() => {
        /* a failed poll is not worth a toast; the next one will try again */
      });
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [waiting, paymentId, checkOnce]);

  useEffect(() => {
    if (checks >= POLL_LIMIT) setWaiting(false);
  }, [checks]);

  const pay = async () => {
    if (busy || lockedMinor === null) return;
    setBusy(true);
    try {
      const { paymentId: id, url } = await createPaymentLink({
        purpose: 'escrow',
        amountMinor: totalMinor,
        taskId,
      });
      setPaymentId(id);
      setPayUrl(url);
      setChecks(0);
      setWaiting(true);
      await Linking.openURL(url);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not start the payment');
      setWaiting(false);
    } finally {
      setBusy(false);
    }
  };

  /** The manual nudge, for when someone paid and came straight back. */
  const checkNow = async () => {
    if (!paymentId || busy) return;
    setBusy(true);
    try {
      const paid = await checkOnce(paymentId);
      if (!paid) flash('No payment seen yet — it can take a few seconds');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not check the payment');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!payUrl) return;
    setChecks(0);
    setWaiting(true);
    await Linking.openURL(payUrl);
  };

  if (lockedMinor === null) {
    // Reached without a locked quote. Previously this screen invented one and
    // offered to charge for it.
    return (
      <Screen padded={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
              <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
            </Pressable>
            <RNText style={tx('700', 17, t.colors.ink)}>Confirm and pay</RNText>
          </View>
          <RNText style={tx('800', 20, t.colors.ink, { marginTop: 40, letterSpacing: -0.4 })}>
            Nothing to pay for yet
          </RNText>
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 10, lineHeight: 21 })}>
            Escrow is funded once you accept a quote. Open the request, pick the quote you want,
            and the amount will be carried through to here.
          </RNText>
          <Pressy
            onPress={() => go('orders')}
            style={{
              marginTop: 22,
              backgroundColor: t.colors.accent,
              borderRadius: 999,
              paddingVertical: 15,
              alignItems: 'center',
            }}
          >
            <RNText style={tx('700', 15, t.colors.onAccent)}>Go to my requests</RNText>
          </Pressy>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={back} hitSlop={10}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <RNText style={tx('700', 17, t.colors.ink)}>Confirm and pay</RNText>
        </View>

        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 24 })}>Into escrow</RNText>
        <RNText style={tx('700', 15, t.colors.ink, { marginTop: 6 })} numberOfLines={2}>
          {title}
        </RNText>
        <RNText style={tx('800', 44, t.colors.ink, { letterSpacing: -1.76, lineHeight: 46.2, marginTop: 5 })}>
          {formatINR(totalMinor)}
        </RNText>

        <View style={{ marginTop: 22 }}>
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
            marginTop: 20,
            backgroundColor: t.colors.accentSoft,
            borderWidth: 1,
            borderColor: t.colors.accentBorder,
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 16,
            flexDirection: 'row',
            gap: 12,
          }}
        >
          <ShieldCheck color={t.colors.accent} />
          <RNText style={tx('400', 13, t.colors.accentDeep, { lineHeight: 19.5, flex: 1 })}>
            Funds are held by TaskDrop and released only when you confirm the work is done.
          </RNText>
        </View>

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>
          PAY WITH
        </RNText>
        {/* There are no saved cards. This used to offer "UPI · 8721" and
            "Card · 4412" — invented digits for accounts nobody had added, and
            tapping one changed nothing, because the real choice is made on
            Razorpay's page. So say what actually happens instead. */}
        <View
          style={{
            marginTop: 11,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
            padding: 15,
          }}
        >
          <RNText style={tx('700', 14, t.colors.ink)}>Razorpay secure checkout</RNText>
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 5, lineHeight: 19 })}>
            UPI, cards, netbanking and wallets. You choose there — TaskDrop never sees your card
            or UPI PIN.
          </RNText>
        </View>

        {waiting && (
          <View
            style={{
              marginTop: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              backgroundColor: t.colors.surface2,
              borderRadius: 12,
              padding: 15,
            }}
          >
            <ActivityIndicator size="small" color={t.colors.accent} />
            <RNText style={tx('400', 13, t.colors.muted, { flex: 1, lineHeight: 19 })}>
              Waiting for your payment to confirm. You can leave this open — it updates itself.
            </RNText>
          </View>
        )}

        {paymentId && !waiting && (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 16, lineHeight: 19 })}>
            Still not confirmed. If you have paid, tap check below — otherwise reopen the payment
            page and finish there.
          </RNText>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressy
          onPress={paymentId ? checkNow : pay}
          scaleTo={0.96}
          style={{
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>
            {busy
              ? 'Checking…'
              : paymentId
                ? 'Check payment now'
                : `Pay ${formatINR(totalMinor)} into escrow`}
          </RNText>
        </Pressy>

        {paymentId && payUrl && (
          <Pressable
            onPress={() => void reopen()}
            accessibilityRole="button"
            accessibilityLabel="Reopen the payment page"
            style={{ marginTop: 12, alignItems: 'center' }}
          >
            <RNText style={tx('700', 13, t.colors.accentDeep)}>Reopen payment page</RNText>
          </Pressable>
        )}
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10 })}>
          Contacts unmask once the task starts.
        </RNText>
      </View>
    </Screen>
  );
}
