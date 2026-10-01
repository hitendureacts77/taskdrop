import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, Modal, TextInput, KeyboardAvoidingView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { savePayoutProfile, type PayoutProfile } from '../data/api';

/**
 * Name and PAN, asked once before the first withdrawal (and editable later).
 *
 * The PAN is checked here for its shape (five letters, four digits, a letter)
 * so a typo is caught while typing; the server checks again and stores it.
 * Only the last four characters are ever shown back.
 */

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function PayoutProfileSheet({
  visible,
  current,
  onClose,
  onSaved,
}: {
  visible: boolean;
  current: PayoutProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [pan, setPan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(current?.legal_name ?? '');
    setPan('');
    setError(null);
  }, [visible, current]);

  const save = async () => {
    if (busy) return;
    const cleanPan = pan.replace(/\s/g, '').toUpperCase();
    if (name.trim().replace(/\s+/g, ' ').length < 3) {
      setError('Enter your full name as it is on your PAN card.');
      return;
    }
    if (!PAN_RE.test(cleanPan)) {
      setError('A PAN is 10 characters, like ABCDE1234F.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await savePayoutProfile(name, cleanPan);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your details');
    } finally {
      setBusy(false);
    }
  };

  const input = (
    label: string,
    value: string,
    onChangeText: (v: string) => void,
    opts: { placeholder: string; caps?: boolean; max?: number },
  ) => (
    <View style={{ marginTop: 14 }}>
      <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>{label.toUpperCase()}</RNText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={opts.placeholder}
        placeholderTextColor={t.colors.muted}
        autoCapitalize={opts.caps ? 'characters' : 'words'}
        autoCorrect={false}
        maxLength={opts.max}
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }} behavior="padding">
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 26,
          }}
        >
          <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>
            {current ? 'Your name and PAN' : 'Before your first withdrawal'}
          </RNText>
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19 })}>
            We send earnings only to the person they belong to, and keep your PAN for tax records. You do this once.
            {current ? ` PAN on file ends in ${current.pan_last4}.` : ''}
          </RNText>

          {input('Full name (as on PAN)', name, setName, { placeholder: 'e.g. Ravi Kumar', max: 80 })}
          {input(current ? 'PAN (type it again to change)' : 'PAN', pan, (v) => setPan(v.toUpperCase()), {
            placeholder: 'ABCDE1234F',
            caps: true,
            max: 12,
          })}

          {error ? <RNText style={tx('600', 12, t.colors.signal, { marginTop: 12, lineHeight: 18 })}>{error}</RNText> : null}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={{ flex: 1, paddingVertical: 14, borderRadius: 999, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center' }}
            >
              <RNText style={tx('700', 14, t.colors.ink)}>Not now</RNText>
            </Pressable>
            <Pressable
              onPress={() => void save()}
              disabled={busy}
              accessibilityRole="button"
              style={{
                flex: 1,
                paddingVertical: 14,
                borderRadius: 999,
                backgroundColor: t.colors.accent,
                alignItems: 'center',
                opacity: busy ? 0.6 : 1,
              }}
            >
              <RNText style={tx('700', 14, t.colors.onAccent)}>{busy ? 'Saving…' : 'Save'}</RNText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
