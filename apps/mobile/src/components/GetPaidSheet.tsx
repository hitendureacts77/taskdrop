import { useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  type ViewInstance,
} from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { moneyPayoutSetup, type PayeeStatus } from '../data/api';
import { useKeyboardClearance } from '../lib/useKeyboardClearance';

/**
 * "Get paid" (Plan B): a worker adds the name on their PAN, the PAN, and a UPI id or bank account once.
 * Everything goes straight to Razorpay; the server keeps only whether it is set up. Nothing typed here is
 * kept: the fields live in this sheet's own state, are cleared the moment they are sent, and are never
 * logged or put in a store. The format lines are hints only; the server decides what is accepted.
 */

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UPI = /^[a-z0-9._-]{2,}@[a-z][a-z0-9.-]{1,}$/i;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^[0-9]{9,18}$/;

type Method = 'upi' | 'bank';

export function GetPaidSheet({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  /** After the details were sent: the status Razorpay gave back. */
  onDone?: (status: PayeeStatus, hint: string | null) => void;
}) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [pan, setPan] = useState('');
  const [method, setMethod] = useState<Method>('upi');
  const [upi, setUpi] = useState('');
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: PayeeStatus; hint: string | null } | null>(null);

  const panelRef = useRef<ViewInstance>(null);
  const lift = useKeyboardClearance(panelRef);

  const clear = () => {
    setName('');
    setPan('');
    setUpi('');
    setAccount('');
    setIfsc('');
  };

  const close = () => {
    clear();
    setError(null);
    setResult(null);
    onClose();
  };

  const ready =
    name.trim().length > 1 &&
    pan.trim().length > 0 &&
    (method === 'upi' ? upi.trim().length > 0 : account.trim().length > 0 && ifsc.trim().length > 0);

  // Hints only: a line under a box that looks off. They never block the button.
  const panHint = pan.length > 0 && !PAN.test(pan.trim().toUpperCase()) ? 'A PAN looks like ABCDE1234F.' : null;
  const upiHint = upi.length > 0 && !UPI.test(upi.trim()) ? 'A UPI ID looks like name@bank.' : null;
  const accountHint = account.length > 0 && !ACCOUNT.test(account.trim()) ? 'An account number is 9 to 18 digits.' : null;
  const ifscHint = ifsc.length > 0 && !IFSC.test(ifsc.trim().toUpperCase()) ? 'An IFSC looks like HDFC0001234.' : null;

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const out = await moneyPayoutSetup({
        name: name.trim(),
        pan: pan.trim().toUpperCase(),
        method,
        ...(method === 'upi' ? { upi: upi.trim() } : { accountNumber: account.trim(), ifsc: ifsc.trim().toUpperCase() }),
      });
      clear(); // Sent. Nothing stays in the app.
      setResult({ status: out.status, hint: out.hint ?? null });
      onDone?.(out.status, out.hint ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your details. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { hint?: string | null; placeholder?: string; caps?: boolean; numeric?: boolean },
  ) => (
    <View style={{ marginTop: 14 }}>
      <RNText style={tx('600', 12, t.colors.muted)}>{label}</RNText>
      <TextInput
        value={value}
        onChangeText={(v) => {
          set(opts.caps ? v.toUpperCase() : v);
          setError(null);
        }}
        placeholder={opts.placeholder}
        placeholderTextColor={t.colors.muted}
        autoCapitalize={opts.caps ? 'characters' : 'none'}
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        keyboardType={opts.numeric ? 'number-pad' : 'default'}
        accessibilityLabel={label}
        style={tx('600', 15, t.colors.ink, {
          marginTop: 6,
          borderWidth: 1,
          borderColor: t.colors.line,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: t.colors.surface,
        })}
      />
      {opts.hint ? <RNText style={tx('400', 12, t.colors.signalDeep, { marginTop: 5 })}>{opts.hint}</RNText> : null}
    </View>
  );

  const chip = (m: Method, label: string) => (
    <Pressable
      key={m}
      onPress={() => {
        setMethod(m);
        setError(null);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: method === m }}
      style={{
        flex: 1,
        paddingVertical: 11,
        borderRadius: 999,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: method === m ? t.colors.accent : t.colors.line,
        backgroundColor: method === m ? t.colors.accentSoft : t.colors.surface,
      }}
    >
      <RNText style={tx('700', 13, method === m ? t.colors.accentDeep : t.colors.ink)}>{label}</RNText>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }} behavior="padding">
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close" />
        <View
          ref={panelRef}
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 28,
            marginBottom: lift,
            maxHeight: '92%',
          }}
        >
          {result ? (
            <>
              <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>
                {result.status === 'active'
                  ? 'You are set up to get paid'
                  : result.status === 'rejected'
                    ? 'Razorpay could not accept these details'
                    : 'Being checked by Razorpay'}
              </RNText>
              {result.hint ? <RNText style={tx('600', 14, t.colors.ink, { marginTop: 10 })}>{result.hint}</RNText> : null}
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 8, lineHeight: 19 })}>
                {result.status === 'pending'
                  ? 'This can take a little while. You can be hired once it is done.'
                  : result.status === 'active'
                    ? 'Your earnings are sent here when a poster approves your work.'
                    : 'Check the details and try again.'}
              </RNText>
              <Pressable
                onPress={close}
                accessibilityRole="button"
                style={{ marginTop: 20, backgroundColor: t.colors.btn, borderRadius: 999, paddingVertical: 15, alignItems: 'center' }}
              >
                <RNText style={tx('700', 15, t.colors.onAccent)}>Done</RNText>
              </Pressable>
            </>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>Get paid</RNText>
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 5, lineHeight: 19 })}>
                Add where your earnings should go. Posters can hire you once this is done.
              </RNText>

              {field('Name as on your PAN', name, setName, { placeholder: 'Full name' })}
              {field('PAN', pan, setPan, { placeholder: 'ABCDE1234F', caps: true, hint: panHint })}

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>{[chip('upi', 'UPI'), chip('bank', 'Bank account')]}</View>

              {method === 'upi' ? (
                field('UPI ID', upi, setUpi, { placeholder: 'name@bank', hint: upiHint })
              ) : (
                <>
                  {field('Account number', account, setAccount, { numeric: true, hint: accountHint })}
                  {field('IFSC', ifsc, setIfsc, { placeholder: 'HDFC0001234', caps: true, hint: ifscHint })}
                </>
              )}

              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 14, lineHeight: 18 })}>
                Sent straight to Razorpay. TaskDrop keeps only whether it is set up.
              </RNText>

              {error ? <RNText style={tx('600', 12, t.colors.signalDeep, { marginTop: 12, lineHeight: 18 })}>{error}</RNText> : null}

              <Pressable
                onPress={() => void submit()}
                disabled={busy || !ready}
                accessibilityRole="button"
                accessibilityLabel="Save payout details"
                style={({ pressed }) => ({
                  marginTop: 18,
                  backgroundColor: t.colors.btn,
                  borderRadius: 999,
                  paddingVertical: 15,
                  alignItems: 'center',
                  opacity: busy || !ready ? 0.5 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <RNText style={tx('700', 15, t.colors.onAccent)}>{busy ? 'Sending…' : 'Save'}</RNText>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
