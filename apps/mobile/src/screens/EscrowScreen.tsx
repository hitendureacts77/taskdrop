import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, ScrollView, Linking } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { createPaymentLink, syncPayment } from '../data/api';
import { Pressy, tx } from '../components/primitives';

const FALLBACK_LOCKED_MINOR = 450000; // ₹4,500

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
  const [payPick, setPayPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const taskId = typeof params.taskId === 'string' ? params.taskId : null;

  const title = typeof params.title === 'string' ? params.title : 'Vintage 35mm film camera';
  const who = typeof params.who === 'string' ? params.who : null;
  const by = typeof params.by === 'string' ? params.by : '9 Sep, 6:00 PM';
  const lockedMinor = typeof params.priceMinor === 'number' ? params.priceMinor : FALLBACK_LOCKED_MINOR;
  const feeMinor = Math.round(lockedMinor * 0.03);
  const totalMinor = lockedMinor + feeMinor;

  const rows: { label: string; value: string; strong: boolean }[] = [
    { label: who ? `Locked quote · ${who}` : 'Locked quote', value: formatINR(lockedMinor), strong: false },
    { label: 'Poster fee · 3%', value: formatINR(feeMinor), strong: false },
    { label: 'Complete by', value: by, strong: false },
    { label: 'Total held', value: formatINR(totalMinor), strong: true },
  ];

  const methods = ['UPI · 8721', 'Card · 4412'];

  // Razorpay opens in the browser as a payment link, so the same flow works on
  // web and in Expo Go. We poll for settlement when the user comes back.
  const pay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { paymentId: id, url } = await createPaymentLink({
        purpose: 'escrow',
        amountMinor: totalMinor,
        taskId,
      });
      setPaymentId(id);
      await Linking.openURL(url);
      flash('Finish the payment, then tap “I’ve paid”');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not start the payment');
    } finally {
      setBusy(false);
    }
  };

  const confirmPaid = async () => {
    if (!paymentId || busy) return;
    setBusy(true);
    try {
      const status = await syncPayment(paymentId);
      if (status !== 'paid') {
        flash('We have not seen that payment yet');
        return;
      }
      roll('escrow', escrow + totalMinor);
      celebrate(`${formatINR(totalMinor)} held in escrow · locked`);
      go('orders');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not check the payment');
    } finally {
      setBusy(false);
    }
  };

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

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>PAY WITH</RNText>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 11 }}>
          {methods.map((label, i) => {
            const on = payPick === i;
            return (
              <Pressy
                key={label}
                onPress={() => setPayPick(i)}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: on ? t.colors.ink : t.colors.line,
                  backgroundColor: on ? t.colors.surface2 : 'transparent',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <RNText style={tx(on ? '700' : '500', 13, on ? t.colors.ink : t.colors.muted)}>{label}</RNText>
              </Pressy>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressy
          onPress={paymentId ? confirmPaid : pay}
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
            {busy ? 'Working…' : paymentId ? 'I’ve paid — check now' : 'Pay into escrow'}
          </RNText>
        </Pressy>
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10 })}>
          Contacts unmask once the task starts.
        </RNText>
      </View>
    </Screen>
  );
}
