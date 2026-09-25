import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import { tx } from './primitives';

/**
 * A stored description is a summary line, then bullets (see
 * briefToDescription). Some bullets are facts ("Location: Somewhere nearby"),
 * the rest are what the worker should do. Printed as-is it reads like a
 * recipe; split apart it reads like a brief.
 */
export type ParsedDescription = {
  summary: string;
  facts: { label: string; value: string }[];
  steps: string[];
};

const BULLET = /^\s*(?:[•\-*·]|\d+[.)])\s+/;
const FACT = /^([A-Z][A-Za-z &/]{1,22}):\s*(.+)$/;

export function parseDescription(text: string | null | undefined): ParsedDescription {
  const summary: string[] = [];
  const facts: ParsedDescription['facts'] = [];
  const steps: string[] = [];
  for (const raw of (text ?? '').split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!BULLET.test(line)) {
      summary.push(line);
      continue;
    }
    const item = line.replace(BULLET, '').trim();
    const fact = FACT.exec(item);
    if (fact) facts.push({ label: fact[1].trim(), value: fact[2].trim() });
    else if (item) steps.push(item);
  }
  return { summary: summary.join(' '), facts, steps };
}

/**
 * One line for a card: the summary when it says something the title doesn't,
 * otherwise the facts and first steps, joined quietly.
 */
export function descriptionPreview(text: string | null | undefined, title?: string): string {
  const d = parseDescription(text);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const summaryAddsSomething = d.summary && norm(d.summary) !== norm(title ?? '');
  const parts = [
    ...(summaryAddsSomething ? [d.summary.replace(/\.$/, '')] : []),
    ...d.facts.map((f) => f.value),
    ...d.steps,
  ];
  return parts.join(' · ');
}

export function TaskDescription({
  text,
  title,
  size = 'md',
}: {
  text: string | null | undefined;
  /** Leave out a summary that only repeats the title. */
  title?: string;
  size?: 'sm' | 'md';
}) {
  const t = useTheme();
  const d = parseDescription(text);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const showSummary = d.summary && norm(d.summary) !== norm(title ?? '');
  const body = size === 'sm' ? 13 : 14;

  if (!showSummary && d.facts.length === 0 && d.steps.length === 0) {
    return <RNText style={tx('400', body, t.colors.muted)}>No description</RNText>;
  }

  return (
    <View style={{ gap: 14 }}>
      {showSummary ? (
        <RNText style={tx('400', body + 1, t.colors.ink, { lineHeight: (body + 1) * 1.5 })}>{d.summary}</RNText>
      ) : null}

      {d.facts.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {d.facts.map((f) => (
            <View
              key={f.label + f.value}
              style={{
                flexGrow: 1,
                flexBasis: '45%',
                backgroundColor: t.colors.surface2,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <RNText style={tx('600', 10, t.colors.muted, { letterSpacing: 1.1 })} numberOfLines={1}>
                {f.label.toUpperCase()}
              </RNText>
              <RNText style={tx('700', 13, t.colors.ink, { marginTop: 3, lineHeight: 18 })}>{f.value}</RNText>
            </View>
          ))}
        </View>
      ) : null}

      {d.steps.length > 0 ? (
        <View>
          <RNText style={tx('600', 10, t.colors.accentDeep, { letterSpacing: 1.3, marginBottom: 4 })}>WHAT’S EXPECTED</RNText>
          {d.steps.map((s, i) => (
            <View
              key={s + i}
              style={{
                flexDirection: 'row',
                gap: 10,
                paddingVertical: 8,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: t.colors.line,
              }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  backgroundColor: t.colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 1,
                }}
              >
                <Icon name="check" size={11} color={t.colors.accentDeep} strokeWidth={2.6} />
              </View>
              <RNText style={tx('500', body, t.colors.text, { flex: 1, lineHeight: body * 1.45 })}>{s}</RNText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
