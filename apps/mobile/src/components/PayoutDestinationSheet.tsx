import { useEffect, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import {
  listPayoutDestinations,
  addPayoutDestination,
  removePayoutDestination,
  setDefaultPayoutDestination,
  describeDestination,
  type PayoutDestination,
} from '../data/api';

/**
 * Where your money goes.
 *
 * This replaces a single text field on the withdraw screen that edited one UPI
 * id in place. One account, no bank option, and changing it silently rewrote
 * the destination for every future payout with no record of what it had been.
 *
 * Now several can be saved and one is the default. Validation happens here so
 * the failure arrives while someone is typing, rather than as a database
 * constraint error after they tap Withdraw — or, worse, as a transfer that
 * goes nowhere.
 */

const UPI_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^[0-9]{6,18}$/;

export function PayoutDestinationSheet({
  visible,
  onClose,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fires whenever the default may have changed, so the caller can re-read. */
  onChanged: (chosen: PayoutDestination | null) => void;
}) {
  const t = useTheme();
  const [rows, setRows] = useState<PayoutDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<'upi' | 'bank' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [upi, setUpi] = useState('');
  const [accName, setAccName] = useState('');
  const [accNo, setAccNo] = useState('');
  const [ifsc, setIfsc] = useState('');

  const refresh = async () => {
    const list = await listPayoutDestinations();
    setRows(list);
    setLoading(false);
    onChanged(list.find((r) => r.is_default) ?? list[0] ?? null);
  };

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setAdding(null);
    setError(null);
    void refresh().catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const resetForm = () => {
    setUpi('');
    setAccName('');
    setAccNo('');
    setIfsc('');
    setError(null);
  };

  const save = async () => {
    if (busy) return;
    setError(null);

    if (adding === 'upi') {
      if (!UPI_RE.test(upi.trim())) {
        setError('That does not look like a UPI id. They look like yourname@bank.');
        return;
      }
    } else {
      if (accName.trim().length < 2) {
        setError('Enter the name on the account.');
        return;
      }
      if (!ACCOUNT_RE.test(accNo.trim())) {
        setError('An account number is 6 to 18 digits, no spaces.');
        return;
      }
      if (!IFSC_RE.test(ifsc.trim().toUpperCase())) {
        setError('An IFSC looks like HDFC0001234 — four letters, a zero, then six more.');
        return;
      }
    }

    setBusy(true);
    try {
      const created =
        adding === 'upi'
          ? await addPayoutDestination({ kind: 'upi', upiId: upi.trim() })
          : await addPayoutDestination({
              kind: 'bank',
              accountName: accName.trim(),
              accountNumber: accNo.trim(),
              ifsc: ifsc.trim().toUpperCase(),
            });
      // The first one saved becomes the default, because otherwise someone adds
      // an account, taps Withdraw, and is told they have no payout account.
      if (rows.length === 0) await setDefaultPayoutDestination(created.id);
      resetForm();
      setAdding(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that account');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (row: PayoutDestination) => {
    if (busy || row.is_default) return;
    setBusy(true);
    try {
      await setDefaultPayoutDestination(row.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch to that account');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: PayoutDestination) => {
    if (busy) return;
    setBusy(true);
    try {
      await removePayoutDestination(row.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that account');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    value: string,
    onChangeText: (v: string) => void,
    opts: { placeholder?: string; keyboard?: 'default' | 'number-pad'; autoCaps?: boolean } = {},
  ) => (
    <View style={{ marginTop: 14 }}>
      <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>
        {label.toUpperCase()}
      </RNText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={opts.placeholder}
        placeholderTextColor={t.colors.muted}
        keyboardType={opts.keyboard === 'number-pad' ? 'number-pad' : 'default'}
        autoCapitalize={opts.autoCaps ? 'characters' : 'none'}
        autoCorrect={false}
        style={tx('400', 15, t.colors.ink, {
          marginTop: 7,
          paddingVertical: 11,
          paddingHorizontal: 13,
          borderRadius: 11,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.line,
        })}
      />
    </View>
  );

  const methodButton = (kind: 'upi' | 'bank', title: string, sub: string) => (
    <Pressable
      onPress={() => {
        resetForm();
        setAdding(kind);
      }}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flex: 1,
        padding: 14,
        borderRadius: 13,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderStyle: 'dashed',
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <RNText style={tx('700', 14, t.colors.ink)}>{title}</RNText>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 17 })}>{sub}</RNText>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}
        behavior="padding"
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 26,
            maxHeight: '88%',
          }}
        >
          <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>
            Where your money goes
          </RNText>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 4 }}>
            {loading ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 20 }}>
                <ActivityIndicator size="small" color={t.colors.accent} />
                <RNText style={tx('400', 13, t.colors.muted)}>Loading your accounts…</RNText>
              </View>
            ) : (
              <>
                {rows.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => void choose(r)}
                    accessibilityRole="button"
                    accessibilityLabel={`Send my money to ${describeDestination(r)}`}
                    accessibilityState={{ selected: r.is_default }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      marginTop: 12,
                      padding: 14,
                      borderRadius: 13,
                      backgroundColor: r.is_default ? t.colors.accentSoft : t.colors.surface,
                      borderWidth: 1,
                      borderColor: r.is_default ? t.colors.accent : t.colors.line,
                      transform: [{ scale: pressed ? 0.99 : 1 }],
                    })}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 11,
                        backgroundColor: r.is_default ? t.colors.bg : t.colors.surface2,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <RNText style={tx('800', 11, t.colors.accentDeep)}>
                        {r.kind === 'upi' ? 'UPI' : 'BANK'}
                      </RNText>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>
                        {describeDestination(r)}
                      </RNText>
                      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                        {r.is_default ? 'Your money is sent here' : 'Tap to send here instead'}
                      </RNText>
                    </View>
                    <Pressable
                      onPress={() => void remove(r)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${describeDestination(r)}`}
                    >
                      <RNText style={tx('700', 12, t.colors.muted)}>Remove</RNText>
                    </Pressable>
                  </Pressable>
                ))}

                {adding === null ? (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                    {methodButton('upi', 'Add UPI', 'Instant, and the usual choice')}
                    {methodButton('bank', 'Add bank', 'Account number and IFSC')}
                  </View>
                ) : adding === 'upi' ? (
                  <View style={{ marginTop: 6 }}>
                    {field('UPI id', upi, setUpi, { placeholder: 'yourname@bank' })}
                  </View>
                ) : (
                  <View style={{ marginTop: 6 }}>
                    {field('Name on the account', accName, setAccName, {
                      placeholder: 'As printed on the passbook',
                    })}
                    {field('Account number', accNo, setAccNo, {
                      placeholder: 'Digits only',
                      keyboard: 'number-pad',
                    })}
                    {field('IFSC', ifsc, setIfsc, {
                      placeholder: 'HDFC0001234',
                      autoCaps: true,
                    })}
                  </View>
                )}

                {error && (
                  <RNText style={tx('600', 12, t.colors.signal, { marginTop: 12, lineHeight: 18 })}>
                    {error}
                  </RNText>
                )}

                {adding !== null && (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                    <Pressable
                      onPress={() => {
                        resetForm();
                        setAdding(null);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel"
                      style={{
                        paddingHorizontal: 18,
                        paddingVertical: 13,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: t.colors.line,
                      }}
                    >
                      <RNText style={tx('700', 14, t.colors.muted)}>Cancel</RNText>
                    </Pressable>
                    <Pressable
                      onPress={() => void save()}
                      accessibilityRole="button"
                      accessibilityLabel="Save this bank or UPI account"
                      style={({ pressed }) => ({
                        flex: 1,
                        backgroundColor: t.colors.accent,
                        borderRadius: 999,
                        paddingVertical: 13,
                        alignItems: 'center',
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                      })}
                    >
                      <RNText style={tx('700', 14, t.colors.onAccent)}>
                        {busy ? 'Saving…' : 'Save account'}
                      </RNText>
                    </Pressable>
                  </View>
                )}

                <RNText style={tx('400', 11, t.colors.muted, { marginTop: 18, lineHeight: 17 })}>
                  Check these carefully. A transfer sent to a wrong but valid UPI id or account
                  number cannot be pulled back.
                </RNText>
              </>
            )}
          </ScrollView>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={({ pressed }) => ({
              marginTop: 16,
              borderRadius: 999,
              paddingVertical: 14,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: t.colors.line,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <RNText style={tx('700', 15, t.colors.ink)}>Done</RNText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
