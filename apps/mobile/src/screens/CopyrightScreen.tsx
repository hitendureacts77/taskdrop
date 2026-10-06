import { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Field, PrimaryButton, SectionTitle, TopBar } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';

/**
 * Copyright and takedown requests -- public, signed in or not, and linked as
 * ?page=copyright. People upload photos, videos and descriptions to tasks,
 * proofs of work and profiles, so a rights holder needs one place that says
 * who to write to and what a notice must contain (17 U.S.C. § 512(c)(3)).
 *
 * The form does not post anywhere: it writes the notice and opens it as an
 * email to the designated agent, with a copy button for when no mail app
 * opens. The agent's details come from the build environment and must match
 * the registration filed at copyright.gov exactly.
 */
const AGENT = {
  name: process.env.EXPO_PUBLIC_COPYRIGHT_AGENT_NAME?.trim() ?? '',
  email: process.env.EXPO_PUBLIC_COPYRIGHT_AGENT_EMAIL?.trim() ?? '',
  address: process.env.EXPO_PUBLIC_COPYRIGHT_AGENT_ADDRESS?.trim() ?? '',
  phone: process.env.EXPO_PUBLIC_COPYRIGHT_AGENT_PHONE?.trim() ?? '',
};

const GOOD_FAITH =
  'I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.';
const UNDER_PENALTY =
  'The information in this notice is accurate, and under penalty of perjury, I am the owner, or authorized to act on behalf of the owner, of an exclusive right that is allegedly infringed.';

export function CopyrightScreen() {
  const t = useTheme();
  const { back } = useNav();
  const { flash } = useActions();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [work, setWork] = useState('');
  const [where, setWhere] = useState('');
  const [goodFaith, setGoodFaith] = useState(false);
  const [sworn, setSworn] = useState(false);
  const [signature, setSignature] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const configured = Boolean(AGENT.email);
  const ready =
    name.trim().length > 1 &&
    /\S+@\S+\.\S+/.test(email) &&
    address.trim().length > 5 &&
    work.trim().length > 5 &&
    where.trim().length > 5 &&
    goodFaith &&
    sworn &&
    signature.trim().length > 1;

  const compose = () =>
    [
      'DMCA takedown notice',
      '',
      `Complaining party: ${name.trim()}`,
      `Email: ${email.trim()}`,
      phone.trim() ? `Phone: ${phone.trim()}` : null,
      `Address: ${address.trim()}`,
      '',
      'Copyrighted work claimed to be infringed:',
      work.trim(),
      '',
      'Material on TaskDrop claimed to be infringing (links or descriptions):',
      where.trim(),
      '',
      GOOD_FAITH,
      UNDER_PENALTY,
      '',
      `Signature: /${signature.trim()}/`,
      `Date: ${new Date().toISOString().slice(0, 10)}`,
    ]
      .filter((l): l is string => l !== null)
      .join('\n');

  const send = async () => {
    if (!ready || !configured) return;
    const body = compose();
    setNotice(body);
    const url = `mailto:${AGENT.email}?subject=${encodeURIComponent('DMCA takedown notice')}&body=${encodeURIComponent(body)}`;
    try {
      await Linking.openURL(url);
    } catch {
      flash('No email app opened. Copy the notice below and email it.');
    }
  };

  const para = (text: string) => (
    <RNText style={tx('400', 14, t.colors.ink, { lineHeight: 21, marginTop: 10 })}>{text}</RNText>
  );
  const item = (n: number, text: string) => (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
      <RNText style={tx('700', 13, t.colors.accentDeep, { width: 18 })}>{n}.</RNText>
      <RNText style={tx('400', 14, t.colors.ink, { flex: 1, lineHeight: 20 })}>{text}</RNText>
    </View>
  );

  return (
    <Screen padded={false}>
      <TopBar title="Copyright" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6 })}>Copyright & takedown requests</RNText>
        {para(
          'People post photos, videos and descriptions on TaskDrop. We respect copyright, and we remove material when we receive a valid notice that it infringes someone’s work.',
        )}

        <SectionTitle title="Our designated copyright agent" style={{ marginTop: 26 }} />
        {configured ? (
          <View style={{ marginTop: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface }}>
            {AGENT.name ? <RNText style={tx('700', 15, t.colors.ink)}>{AGENT.name}</RNText> : null}
            {AGENT.address ? <RNText style={tx('400', 14, t.colors.ink, { marginTop: 4, lineHeight: 20 })}>{AGENT.address}</RNText> : null}
            <RNText style={tx('600', 14, t.colors.accentDeep, { marginTop: 6 })}>{AGENT.email}</RNText>
            {AGENT.phone ? <RNText style={tx('400', 14, t.colors.ink, { marginTop: 2 })}>{AGENT.phone}</RNText> : null}
          </View>
        ) : (
          <View style={{ marginTop: 10, padding: 14, borderRadius: 14, backgroundColor: t.colors.goldSoft }}>
            <RNText style={tx('600', 13, t.colors.goldInk, { lineHeight: 19 })}>
              {__DEV__
                ? 'Not configured: set EXPO_PUBLIC_COPYRIGHT_AGENT_NAME, _EMAIL, _ADDRESS and _PHONE to the details registered at copyright.gov, then rebuild.'
                : 'Notices can’t be sent from this page right now. Please write to us through Help & support in the app.'}
            </RNText>
          </View>
        )}

        <SectionTitle title="What a notice must include" style={{ marginTop: 26 }} />
        {para('Under the U.S. Digital Millennium Copyright Act, a notice is valid only if it includes all of these:')}
        {item(1, 'Your physical or electronic signature.')}
        {item(2, 'The copyrighted work you say was infringed (or, for several works, a representative list).')}
        {item(3, 'The material on TaskDrop you say infringes it, with enough detail for us to find it — a task link is best.')}
        {item(4, 'Your name, postal address, phone number and email address.')}
        {item(5, 'A statement that you have a good faith belief the use is not authorized by the owner, its agent, or the law.')}
        {item(6, 'A statement that the notice is accurate and, under penalty of perjury, that you are the owner or authorized to act for them.')}
        {para('Knowingly misrepresenting that material infringes can make you liable for damages, including our costs and attorneys’ fees.')}

        <SectionTitle title="Send a notice" style={{ marginTop: 26 }} />
        <Field label="Your full name" value={name} onChangeText={setName} style={{ marginTop: 12 }} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={{ marginTop: 12 }} />
        <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={{ marginTop: 12 }} />
        <Field label="Postal address" value={address} onChangeText={setAddress} multiline minHeight={64} style={{ marginTop: 12 }} />
        <Field
          label="Your copyrighted work"
          value={work}
          onChangeText={setWork}
          multiline
          placeholder="What it is, and where the original can be seen"
          style={{ marginTop: 12 }}
        />
        <Field
          label="Where it is on TaskDrop"
          value={where}
          onChangeText={setWhere}
          multiline
          placeholder="Task links, or the task title and the person who posted it"
          style={{ marginTop: 12 }}
        />
        <Statement checked={goodFaith} onToggle={() => setGoodFaith((v) => !v)} text={GOOD_FAITH} />
        <Statement checked={sworn} onToggle={() => setSworn((v) => !v)} text={UNDER_PENALTY} />
        <Field
          label="Signature — type your full name"
          value={signature}
          onChangeText={setSignature}
          style={{ marginTop: 14 }}
        />
        <PrimaryButton
          label="Write the email"
          onPress={() => void send()}
          disabled={!ready || !configured}
          style={{ marginTop: 18, borderRadius: 999 }}
        />
        {notice ? (
          <View style={{ marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: t.colors.surface2 }}>
            <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>
              If no email opened, copy the notice and send it to {AGENT.email}.
            </RNText>
            <Pressable
              onPress={() => void Clipboard.setStringAsync(notice).then(() => flash('Notice copied'))}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}
            >
              <Icon name="copy" size={16} color={t.colors.accentDeep} />
              <RNText style={tx('700', 14, t.colors.accentDeep)}>Copy the notice</RNText>
            </Pressable>
          </View>
        ) : null}

        <SectionTitle title="If your material was removed" style={{ marginTop: 30 }} />
        {para(
          'We tell the person who posted it when we remove material. If you believe it was removed by mistake or misidentification, you can send our agent a counter-notice containing:',
        )}
        {item(1, 'Your physical or electronic signature.')}
        {item(2, 'The material that was removed and where it appeared before removal.')}
        {item(3, 'A statement under penalty of perjury that you have a good faith belief it was removed as a result of mistake or misidentification.')}
        {item(
          4,
          'Your name, address and phone number, and a statement that you consent to the jurisdiction of the U.S. federal district court for your address (or, outside the U.S., any judicial district in which TaskDrop may be found), and that you will accept service of process from the person who sent the notice.',
        )}
        {para(
          'We then send the counter-notice to the person who complained. Unless they tell us within 10 business days that they have filed a court action, we restore the material in 10 to 14 business days.',
        )}

        <SectionTitle title="Repeat infringers" style={{ marginTop: 30 }} />
        {para('We close the accounts of people who repeatedly post material that infringes others’ copyright.')}
      </ScrollView>
    </Screen>
  );
}

/** A statement the sender must affirm, as a tappable checkbox row. */
function Statement({ checked, onToggle, text }: { checked: boolean; onToggle: () => void; text: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ flexDirection: 'row', gap: 12, marginTop: 14, alignItems: 'flex-start' }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          marginTop: 1,
          borderWidth: 1.5,
          borderColor: checked ? t.colors.accent : t.colors.line,
          backgroundColor: checked ? t.colors.accent : t.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={3} /> : null}
      </View>
      <RNText style={tx('400', 13, t.colors.ink, { flex: 1, lineHeight: 19 })}>{text}</RNText>
    </Pressable>
  );
}
