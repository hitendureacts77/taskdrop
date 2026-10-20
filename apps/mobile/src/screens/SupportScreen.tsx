import { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, Linking } from 'react-native';
import { Screen } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { PrimaryButton, TopBar } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { company } from '../legal/company';

/**
 * Support -- public, signed in or not, and linked as ?page=support. The app
 * stores ask for one address that explains how to get help, and a person who
 * cannot sign in has no Help & support to open, so this page works without an
 * account: contact details, answers to the questions people actually ask, and
 * the legal pages. Signed in, it hands over to Help & support (HelpScreen),
 * where a conversation with the team is kept.
 *
 * Every answer below describes what the app does today (the codes, limits and
 * rules are the ones in supabase/functions/phone-auth, the money migrations and
 * AccountScreen). Fees and day counts are admin-configurable, so the page does
 * not repeat them; "How fees work" reads the live values.
 */

type Answer = { id: string; q: string; a: string; link?: { label: string; to: ScreenName; signedIn?: boolean } };

const ANSWERS: Answer[] = [
  {
    id: 'code',
    q: 'I did not get my sign-in code',
    a: 'Codes are sent by text and work for 10 minutes. You can ask for a new one after a minute, and after 5 wrong tries you need a new code. If texts are not reaching you, sign in another way: with Google or Apple, or with your username and password if you set one in Account & settings. Still stuck? Write to us.',
  },
  {
    id: 'pay',
    q: 'How is my money protected?',
    a: 'When you accept an offer, the price and the hiring fee are paid to TaskDrop, which holds the money until you approve the work. If you do not approve or ask for changes within the review period shown on the job, the payment is released to the worker automatically.',
    link: { label: 'How fees work', to: 'pricing', signedIn: true },
  },
  {
    id: 'work',
    q: 'The work is not what I asked for',
    a: 'Ask for changes on the job first. If you and the worker cannot agree, open a dispute from the job. The team reads the chat and the proof of work and decides how the held money is split.',
  },
  {
    id: 'cancel',
    q: 'Can I cancel a job?',
    a: 'Yes. Before work starts it costs nothing and your money comes back. If the worker has already started, they are paid a small cancellation fee for the time they put in and the rest is refunded. Once the work has been handed in, open a dispute instead.',
  },
  {
    id: 'withdraw',
    q: 'How do I withdraw money?',
    a: 'Open your wallet and choose Withdraw. Save a UPI ID or bank account first. The first time, we also ask for your name as on your PAN card, and your PAN. There is a minimum amount and no withdrawal fee. Earnings reach the wallet after the clearing period, and a withdrawal usually arrives within one working day.',
    link: { label: 'Open wallet', to: 'wallet', signedIn: true },
  },
  {
    id: 'report',
    q: 'How do I report or block someone?',
    a: 'Open their profile or the post and choose Report. You can block them from the same sheet. People you have blocked are listed in Account & settings, where you can unblock them. The team reviews reports.',
  },
  {
    id: 'delete',
    q: 'How do I delete my account?',
    a: 'Go to Account & settings and choose Delete account. It works once nothing is in progress: no money in the wallet or on its way to you, and no task under way or in dispute. The app tells you what is in the way. If you are stuck, write to us. What we keep afterwards is in the Privacy Policy.',
    link: { label: 'Account & settings', to: 'account', signedIn: true },
  },
  {
    id: 'copyright',
    q: 'Someone posted my work without permission',
    a: 'Use the Copyright page. It says what a notice must contain and writes it for you.',
    link: { label: 'Copyright & takedowns', to: 'copyright' },
  },
];

export function SupportScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { userId } = useAuth();
  const [open, setOpen] = useState<string | null>(null);

  const mail = (to: string) => {
    void Linking.openURL(`mailto:${to}?subject=${encodeURIComponent('TaskDrop support')}`).catch(() => {});
  };

  const card = {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.colors.line,
    backgroundColor: t.colors.surface,
  } as const;

  return (
    <Screen padded={false}>
      <TopBar title="Support" onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6 })}>How can we help?</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 6, lineHeight: 21 })}>
          Find a quick answer below, or write to the team.
        </RNText>

        <View style={[card, { marginTop: 18, padding: 16, backgroundColor: t.colors.accentSoft, borderColor: t.colors.accentBorder }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="chat" size={20} color={t.colors.accentDeep} />
            <RNText style={tx('800', 16, t.colors.ink)}>Talk to the team</RNText>
          </View>
          {userId ? (
            <>
              <RNText style={tx('400', 13, t.colors.ink, { marginTop: 8, lineHeight: 19 })}>
                Send a message from Help & support. Replies come back to you there, and as a notification.
              </RNText>
              <PrimaryButton label="Open Help & support" onPress={() => go('help')} style={{ marginTop: 14 }} />
            </>
          ) : (
            <>
              <RNText style={tx('400', 13, t.colors.ink, { marginTop: 8, lineHeight: 19 })}>
                {company.email
                  ? 'Cannot sign in, or do not have an account yet? Email us. If you can sign in, use Help & support so the whole conversation stays in the app.'
                  : 'Sign in to message the team from Help & support. Replies come back to you there, and as a notification.'}
              </RNText>
              {!company.email ? <PrimaryButton label="Sign in" onPress={() => go('welcome')} style={{ marginTop: 14 }} /> : null}
            </>
          )}
          {company.email ? (
            <Pressable
              onPress={() => mail(company.email!)}
              accessibilityRole="link"
              accessibilityLabel={`Email ${company.email}`}
              hitSlop={8}
              style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Icon name="send" size={16} color={t.colors.accentDeep} />
              <RNText style={tx('700', 14, t.colors.accentDeep)}>{company.email}</RNText>
            </Pressable>
          ) : null}
        </View>

        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 26 })}>QUICK ANSWERS</RNText>
        <View style={{ marginTop: 10, gap: 8 }}>
          {ANSWERS.map((x) => {
            const on = open === x.id;
            const link = x.link && (!x.link.signedIn || userId) ? x.link : null;
            return (
              <View key={x.id} style={card}>
                <Pressable
                  onPress={() => setOpen(on ? null : x.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: on }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, opacity: pressed ? 0.8 : 1 })}
                >
                  <RNText style={tx('700', 14, t.colors.ink, { flex: 1, lineHeight: 20 })}>{x.q}</RNText>
                  <RNText style={tx('600', 18, t.colors.muted)}>{on ? '–' : '+'}</RNText>
                </Pressable>
                {on ? (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                    <RNText style={tx('400', 13, t.colors.ink, { lineHeight: 20 })}>{x.a}</RNText>
                    {link ? (
                      <Pressable onPress={() => go(link.to)} accessibilityRole="link" hitSlop={8} style={{ marginTop: 10 }}>
                        <RNText style={tx('700', 13, t.colors.accentDeep)}>{link.label} ›</RNText>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 26 })}>RULES AND POLICIES</RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 12, paddingHorizontal: 2 }}>
          {(
            [
              ['terms', 'Terms of Service', 'shield'],
              ['privacy', 'Privacy Policy', 'lock'],
              ['copyright', 'Copyright', 'flag'],
            ] as [ScreenName, string, IconName][]
          ).map(([page, label, icon]) => (
            <Pressable key={page} onPress={() => go(page)} accessibilityRole="link" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={icon} size={14} color={t.colors.accentDeep} />
              <RNText style={tx('700', 13, t.colors.accentDeep)}>{label}</RNText>
            </Pressable>
          ))}
        </View>

        <View style={[card, { marginTop: 22, padding: 14 }]}>
          <RNText style={tx('800', 14, t.colors.ink)}>Complaints and the Grievance Officer</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6, lineHeight: 18 })}>
            For a complaint about TaskDrop or content on it, write to our Grievance Officer. We acknowledge complaints within 24 hours and aim to resolve them within 15 days.
          </RNText>
          <RNText style={tx('600', 13, t.colors.ink, { marginTop: 8 })}>{company.grievanceName ?? 'Grievance Officer'}</RNText>
          {company.grievanceEmail ? (
            <Pressable onPress={() => mail(company.grievanceEmail!)} accessibilityRole="link" hitSlop={8} style={{ marginTop: 4 }}>
              <RNText style={tx('700', 13, t.colors.accentDeep)}>{company.grievanceEmail}</RNText>
            </Pressable>
          ) : (
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>Through Help & support in the app.</RNText>
          )}
          {company.address ? <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>{company.address}</RNText> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
