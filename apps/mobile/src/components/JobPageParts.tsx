import type React from 'react';
import { View, Text as RNText } from 'react-native';
import { cardSurface } from './ui';
import { Icon, type IconName } from './Icon';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';

/**
 * The pieces of a job page laid out like an Upwork contract page (D31 v11, boards Active and WorkActive):
 * a status banner, titled cards, money rows and a progress list. Plain views; the screen (ActiveScreen)
 * owns the data and the actions. The accent follows the mode, so Earn reads royal blue and Hire jade.
 */

export type BannerTone = 'accent' | 'gold' | 'signal' | 'neutral';

/** Where the job stands, in one tinted box. `timer` is the big running clock on the worker's side. */
export function StatusBanner({
  tone,
  icon,
  title,
  body,
  timer,
}: {
  tone: BannerTone;
  icon?: IconName;
  title?: string;
  body?: React.ReactNode;
  timer?: string;
}) {
  const t = useTheme();
  const c = t.colors;
  const bg = tone === 'accent' ? c.accentSoft : tone === 'gold' ? c.goldSoft : tone === 'signal' ? c.signalSoft : c.surface2;
  const ink = tone === 'accent' ? c.accentDeep : tone === 'gold' ? c.goldInk : tone === 'signal' ? c.signalDeep : c.text;
  const border = tone === 'accent' ? c.accentBorder : bg;
  if (timer) {
    return (
      <View
        accessibilityRole="summary"
        style={{ marginTop: 12, backgroundColor: bg, borderColor: border, borderWidth: 1, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center' }}
      >
        <RNText style={tx('800', 40, ink, { letterSpacing: -1, fontVariant: ['tabular-nums'] })}>{timer}</RNText>
        {title ? <RNText style={tx('600', 13, ink, { marginTop: 4, textAlign: 'center' })}>{title}</RNText> : null}
        {body ? <RNText style={tx('400', 12, ink, { marginTop: 4, textAlign: 'center', lineHeight: 18 })}>{body}</RNText> : null}
      </View>
    );
  }
  return (
    <View
      accessibilityRole="summary"
      style={{ marginTop: 12, backgroundColor: bg, borderColor: border, borderWidth: 1, borderRadius: 18, padding: 14 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Icon name={icon} size={16} color={ink} /> : null}
        {title ? <RNText style={tx('700', 14, ink, { flex: 1 })}>{title}</RNText> : null}
      </View>
      {body ? <RNText style={tx('400', 12, ink, { marginTop: 6, lineHeight: 18 })}>{body}</RNText> : null}
    </View>
  );
}

/** A white card with a small uppercase caption, like the boards' PAYMENT, PROGRESS and JOB DETAILS. */
export function SectionCard({ caption, children, first }: { caption?: string; children: React.ReactNode; first?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: first ? 0 : 12, ...cardSurface(t, 18), padding: 15 }}>
      {caption ? <Caption>{caption}</Caption> : null}
      {children}
    </View>
  );
}

export function Caption({ children, style }: { children: string; style?: object }) {
  const t = useTheme();
  return <RNText style={tx('700', 10, t.colors.muted, { letterSpacing: 1.2, ...style })}>{children.toUpperCase()}</RNText>;
}

/** One line of a money summary: a label on the left, the figure on the right in tabular numbers. */
export function MoneyRow({
  label,
  value,
  strong,
  big,
  color,
  icon,
}: {
  label: string;
  value: string;
  strong?: boolean;
  big?: boolean;
  color?: string;
  icon?: IconName;
}) {
  const t = useTheme();
  const ink = color ?? (strong ? t.colors.ink : t.colors.text);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
      {icon ? <Icon name={icon} size={14} color={ink} /> : null}
      <RNText style={tx(strong ? '700' : '400', 14, ink, { flex: 1 })}>{label}</RNText>
      <RNText style={tx(strong ? '800' : '600', big ? 20 : 14, ink, { fontVariant: ['tabular-nums'] })}>{value}</RNText>
    </View>
  );
}

/** A small tinted line under a money summary ("TaskDrop holds it until you approve."). */
export function MoneyNote({ icon = 'lock', children, tone = 'accent' }: { icon?: IconName; children: React.ReactNode; tone?: 'accent' | 'signal' | 'neutral' }) {
  const t = useTheme();
  const c = t.colors;
  const bg = tone === 'accent' ? c.accentSoft : tone === 'signal' ? c.signalSoft : c.surface2;
  const ink = tone === 'accent' ? c.accentDeep : tone === 'signal' ? c.signalDeep : c.text;
  return (
    <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 }}>
      <Icon name={icon} size={13} color={ink} />
      <RNText style={tx('600', 12, ink, { flex: 1, lineHeight: 17 })}>{children}</RNText>
    </View>
  );
}

export type ProgressStep = { label: string; at: string | null | undefined; reached: boolean };

/** The job's live steps, ticked as they are reached, with the time each happened; the next one says "Pending". */
export function ProgressList({ steps, when }: { steps: ProgressStep[]; when: (iso: string) => string }) {
  const t = useTheme();
  const next = steps.findIndex((s) => !s.reached);
  return (
    <View style={{ marginTop: 6 }}>
      {steps.map((s, i) => (
        <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <View style={{ width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: s.reached ? t.colors.accent : t.colors.surface2 }}>
            {s.reached ? <Icon name="check" size={12} color={t.colors.onAccent} strokeWidth={3} /> : null}
          </View>
          <RNText style={tx(s.reached ? '600' : '400', 13, s.reached ? t.colors.ink : t.colors.muted, { flex: 1 })}>{s.label}</RNText>
          {s.reached && s.at ? (
            <RNText style={tx('400', 11, t.colors.muted)}>{when(s.at)}</RNText>
          ) : i === next ? (
            <RNText style={tx('400', 11, t.colors.muted)}>Pending</RNText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** One fact in Job details: an icon, the fact in bold and a small line under it. */
export function DetailRow({ icon, value, sub }: { icon: IconName; value: string; sub: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 8 }}>
      <Icon name={icon} size={16} color={t.colors.ink} />
      <View style={{ flex: 1 }}>
        <RNText style={tx('700', 14, t.colors.ink)}>{value}</RNText>
        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>{sub}</RNText>
      </View>
    </View>
  );
}
