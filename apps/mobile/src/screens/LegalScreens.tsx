import { View, Text as RNText, ScrollView } from 'react-native';
import { Screen } from '../components/ui';
import { TopBar } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { company, unset } from '../legal/company';
import { PRIVACY, TERMS, type LegalDoc } from '../legal/documents';

/**
 * Terms of Service and Privacy Policy -- public, signed in or not, and linked
 * as ?page=terms and ?page=privacy. The text is in src/legal/documents.ts.
 */
export function TermsScreen() {
  return <LegalPage doc={TERMS} />;
}

export function PrivacyScreen() {
  return <LegalPage doc={PRIVACY} />;
}

function LegalPage({ doc }: { doc: LegalDoc }) {
  const t = useTheme();
  const { back } = useNav();

  return (
    <Screen padded={false}>
      <TopBar title={doc.title} onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {!company.reviewed ? (
          // Until a lawyer signs off (EXPO_PUBLIC_LEGAL_REVIEWED=yes), say so.
          <View style={{ padding: 14, borderRadius: 14, backgroundColor: t.colors.goldSoft, marginBottom: 18 }}>
            <RNText style={tx('700', 13, t.colors.goldInk)}>Draft — under legal review</RNText>
            <RNText style={tx('400', 12, t.colors.goldInk, { marginTop: 4, lineHeight: 18 })}>
              {__DEV__ && unset.length > 0
                ? `Not set yet: ${unset.join(', ')}. Set EXPO_PUBLIC_LEGAL_REVIEWED=yes once a lawyer approves this text.`
                : 'This text may change before it is final.'}
            </RNText>
          </View>
        ) : null}

        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6 })}>{doc.title}</RNText>
        <RNText style={tx('500', 12, t.colors.muted, { marginTop: 6 })}>Last updated {doc.updated}</RNText>
        <RNText style={tx('400', 14, t.colors.ink, { marginTop: 14, lineHeight: 21 })}>{doc.intro}</RNText>

        {doc.sections.map((s, i) => (
          <View key={s.heading} style={{ marginTop: 24 }}>
            <RNText style={tx('800', 17, t.colors.ink, { letterSpacing: -0.3 })}>
              {i + 1}. {s.heading}
            </RNText>
            {s.body.map((b, j) =>
              typeof b === 'string' ? (
                <RNText key={j} style={tx('400', 14, t.colors.ink, { marginTop: 10, lineHeight: 21 })}>
                  {b}
                </RNText>
              ) : (
                <View key={j} style={{ marginTop: 6 }}>
                  {b.list.map((item) => (
                    <View key={item} style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                      <RNText style={tx('700', 14, t.colors.accentDeep, { lineHeight: 21 })}>•</RNText>
                      <RNText style={tx('400', 14, t.colors.ink, { flex: 1, lineHeight: 21 })}>{item}</RNText>
                    </View>
                  ))}
                </View>
              ),
            )}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
