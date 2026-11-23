import { useEffect, useState } from 'react';
import { Text as RNText, type StyleProp, type ViewStyle } from 'react-native';
import { Field } from './kit';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import { usernameAvailable } from '../data/extras';
import { nameCarriesContact } from '../lib/mask';
import { cleanUsername, usernameFormatOk } from '../lib/username';

/**
 * Whether `username` may be saved: the format, no phone number or email in it, and (asked a moment after typing
 * stops) whether it is free. `free` is null while unknown. Shared by setup and the "Pick a username" page (plan 1.18).
 */
export function useUsernameCheck(username: string): { ok: boolean; free: boolean | null } {
  const [free, setFree] = useState<boolean | null>(null);
  useEffect(() => {
    const h = username.trim();
    if (!usernameFormatOk(h)) {
      setFree(null);
      return;
    }
    // alive: a slow answer for an earlier handle must not overwrite the answer for the one now typed (Y4).
    let alive = true;
    const id = setTimeout(() => void usernameAvailable(h).then((ok) => alive && setFree(ok)), 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [username]);
  return { ok: usernameFormatOk(username) && !nameCarriesContact(username), free };
}

/** The @username box from setup: cleans what is typed and says why a name cannot be used. */
export function UsernameField({
  value,
  onChangeText,
  check,
  style,
}: {
  value: string;
  onChangeText: (v: string) => void;
  check: { ok: boolean; free: boolean | null };
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Field
      value={value}
      onChangeText={(v) => onChangeText(cleanUsername(v))}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus
      placeholder="yourname"
      left={<RNText style={tx('600', 16, t.colors.muted)}>@</RNText>}
      style={style}
      error={value && !check.ok ? '3–20 characters: a–z, 0–9 and _' : check.free === false ? 'That username is taken' : null}
      hint={check.free ? '✓ Available' : undefined}
    />
  );
}
