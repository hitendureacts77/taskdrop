import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { formatINR } from './ui';
import { createPaymentLink, syncPayment } from '../data/api';

/**
 * Adding money to the wallet.
 *
 * What this replaces did two things wrong. It never asked how much — every
 * top-up was a hard-coded ₹1,000 — and once the payment page opened it made
 * the payer come back and tap "I've paid — check now", which is the app asking
 * the user to do the app's job, and getting it wrong if they tapped early.
 *
 * Real payment flows do neither. You enter an amount, you pay, and the app
 * watches for the money and moves on by itself. The webhook already settles a
 * payment the moment Razorpay confirms it, so all this has to do is notice.
 */

const QUICK = [50000, 100000, 200000, 500000];
/** Below this, the gateway's own fee is most of the transaction. */
const MIN_MINOR = 1000;
/** A sanity ceiling, not a policy — nobody tops up two lakh by accident. */
const MAX_MINOR = 20000000;

const POLL_MS = 3000;
/** About three minutes, then stop: waiting longer will not produce an answer. */
const POLL_LIMIT = 60;

type Phase = 'amount' | 'waiting' | 'stalled';

export function AddFundsSheet({
  visible,
  onClose,
  onFunded,
  flash,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fires once the money is actually in, with the amount that landed. */
  onFunded: (amountMinor: number) => void;
  flash: (msg: string) => void;
}) {
  const t = useTheme();
  const [phase, setPhase] = useState<Phase>('amount');
  const [rupees, setRupees] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<{ id: string; url: string; amountMinor: number } | null>(
    null,
  );
  const [checks, setChecks] = useState(0);

  const settled = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setPhase('amount');
    setRupees('');
    setError(null);
    setPayment(null);
    setChecks(0);
    settled.current = false;
  }, [visible]);

  const amountMinor = Math.round((Number(rupees.replace(/[^0-9]/g, '')) || 0) * 100);

  const checkOnce = useCallback(
    async (id: string, amount: number): Promise<boolean> => {
      const status = await syncPayment(id);
      if (status !== 'paid') return false;
      if (settled.current) return true;
      settled.current = true;
      onFunded(amount);
      return true;
    },
    [onFunded],
  );

  // Watch for the money instead of asking whether it arrived.
  useEffect(() => {
    if (phase !== 'waiting' || !payment) return;
    let alive = true;
    const timer = setInterval(() => {
      if (!alive) return;
      setChecks((n) => n + 1);
      void checkOnce(payment.id, payment.amountMinor).catch(() => {
        /* one failed poll is not worth a message; the next will try again */
      });
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, payment, checkOnce]);

  useEffect(() => {
    if (checks >= POLL_LIMIT && phase === 'waiting') setPhase('stalled');
  }, [checks, phase]);

  const start = async () => {
    if (busy) return;
    setError(null);

    if (amountMinor < MIN_MINOR) {
      setError(`The smallest top-up is ${formatINR(MIN_MINOR)}.`);
      return;
    }
    if (amountMinor > MAX_MINOR) {
      setError(`That is over the ${formatINR(MAX_MINOR)} limit for one top-up.`);
      return;
    }

    setBusy(true);
    try {
      const { paymentId, url } = await createPaymentLink({ purpose: 'topup', amountMinor });
      setPayment({ id: paymentId, url, amountMinor });
      setChecks(0);
      setPhase('waiting');
      await Linking.openURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment');
      setPhase('amount');
    } finally {
      setBusy(false);
    }
  };

  const checkNow = async () => {
    if (!payment || busy) return;
    setBusy(true);
    try {
      const paid = await checkOnce(payment.id, payment.amountMinor);
      if (!paid) flash('Still nothing — if you have paid, give it a few more seconds');
      else setPhase('waiting');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not check that payment');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!payment) return;
    setChecks(0);
    setPhase('waiting');
    await Linking.openURL(payment.url);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 28,
          }}
        >
          {phase === 'amount' ? (
            <>
              <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>
                Add money
              </RNText>
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 5, lineHeight: 19 })}>
                Goes into your TaskDrop wallet. You can spend it on escrow, or withdraw it again.
              </RNText>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 20,
                  paddingBottom: 10,
                  borderBottomWidth: 2,
                  borderBottomColor: amountMinor > 0 ? t.colors.accent : t.colors.line,
                }}
              >
                <RNText style={tx('800', 34, t.colors.ink)}>₹</RNText>
                <TextInput
                  value={rupees}
                  onChangeText={(v) => {
                    // Digits only: a rupee field that accepts letters is a
                    // field that produces a confusing error later.
                    setRupees(v.replace(/[^0-9]/g, ''));
                    setError(null);
                  }}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={t.colors.line}
                  autoFocus
                  accessibilityLabel="How much to add, in rupees"
                  style={tx('800', 34, t.colors.ink, { flex: 1, padding: 0 })}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {QUICK.map((minor) => (
                  <Pressable
                    key={minor}
                    onPress={() => {
                      setRupees(String(minor / 100));
                      setError(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${formatINR(minor)}`}
                    style={({ pressed }) => ({
                      paddingHorizontal: 15,
                      paddingVertical: 9,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: amountMinor === minor ? t.colors.accent : t.colors.line,
                      backgroundColor:
                        amountMinor === minor ? t.colors.accentSoft : t.colors.surface,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <RNText
                      style={tx(
                        '700',
                        12,
                        amountMinor === minor ? t.colors.accentDeep : t.colors.ink,
                      )}
                    >
                      {formatINR(minor)}
                    </RNText>
                  </Pressable>
                ))}
              </View>

              {error && (
                <RNText style={tx('600', 12, t.colors.signal, { marginTop: 14, lineHeight: 18 })}>
                  {error}
                </RNText>
              )}

              <Pressable
                onPress={() => void start()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Continue to payment"
                style={({ pressed }) => ({
                  marginTop: 20,
                  backgroundColor: t.colors.accent,
                  borderRadius: 999,
                  paddingVertical: 15,
                  alignItems: 'center',
                  opacity: amountMinor <= 0 ? 0.45 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <RNText style={tx('700', 15, t.colors.onAccent)}>
                  {busy
                    ? 'Opening…'
                    : amountMinor > 0
                      ? `Pay ${formatINR(amountMinor)}`
                      : 'Enter an amount'}
                </RNText>
              </Pressable>

              <RNText style={tx('400', 11, t.colors.muted, { marginTop: 12, lineHeight: 17 })}>
                Paid on Razorpay&apos;s secure page — UPI, cards, netbanking. TaskDrop never sees
                your card or UPI PIN.
              </RNText>
            </>
          ) : (
            <>
              <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>
                {phase === 'waiting' ? 'Waiting for your payment' : 'Still nothing'}
              </RNText>
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19 })}>
                {phase === 'waiting'
                  ? `${formatINR(payment?.amountMinor ?? 0)} will appear in your wallet on its own as soon as it confirms. You can leave this open.`
                  : 'We have not seen this payment. If you finished paying, it may still be on its way — otherwise reopen the page and try again.'}
              </RNText>

              {phase === 'waiting' && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    marginTop: 18,
                    padding: 16,
                    borderRadius: 12,
                    backgroundColor: t.colors.surface2,
                  }}
                >
                  <ActivityIndicator color={t.colors.accent} />
                  <RNText style={tx('400', 13, t.colors.muted, { flex: 1 })}>
                    Checking with the bank…
                  </RNText>
                </View>
              )}

              <Pressable
                onPress={() => void reopen()}
                accessibilityRole="button"
                accessibilityLabel="Reopen the payment page"
                style={({ pressed }) => ({
                  marginTop: 18,
                  backgroundColor: t.colors.accent,
                  borderRadius: 999,
                  paddingVertical: 15,
                  alignItems: 'center',
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <RNText style={tx('700', 15, t.colors.onAccent)}>Reopen payment page</RNText>
              </Pressable>

              {/* Only here once watching has stopped. Offering it while the poll
                  is running invites the tap that used to give a wrong answer. */}
              {phase === 'stalled' && (
                <Pressable
                  onPress={() => void checkNow()}
                  accessibilityRole="button"
                  accessibilityLabel="Check again"
                  style={{ marginTop: 12, alignItems: 'center', paddingVertical: 8 }}
                >
                  <RNText style={tx('700', 13, t.colors.accentDeep)}>
                    {busy ? 'Checking…' : 'Check again'}
                  </RNText>
                </Pressable>
              )}
            </>
          )}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ marginTop: 14, alignItems: 'center', paddingVertical: 8 }}
          >
            <RNText style={tx('600', 14, t.colors.muted)}>
              {phase === 'amount' ? 'Cancel' : 'Close'}
            </RNText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
