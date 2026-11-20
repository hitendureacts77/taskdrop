import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { Icon, type IconName } from '../Icon';
import { HitArea, tx } from '../primitives';

/**
 * Small pieces shared by the My tasks / My work cards, the "Needs you now" card and the desktop tables
 * (D31 v11). Colours come from the theme; on the Earn side `accent*` is the royal blue set.
 */

export type BoxTone = 'accent' | 'gold' | 'signal';

/** Background and ink of a tinted box or icon tile. */
export function useToneSet(tone: BoxTone): { bg: string; fg: string } {
  const t = useTheme();
  if (tone === 'gold') return { bg: t.colors.goldSoft, fg: t.colors.goldInk };
  if (tone === 'signal') return { bg: t.colors.signalSoft, fg: t.colors.signalDeep };
  return { bg: t.colors.accentSoft, fg: t.colors.accentDeep };
}

/**
 * A button: `primary` is the filled deep shade, `quiet` the grey one beside it, `outline` the bordered one the
 * desktop rows and Edit offer use. `big` fills its row (cards); small hugs its label (table rows).
 */
export function ActionButton({
  label,
  onPress,
  kind = 'primary',
  big = false,
  a11y,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'quiet' | 'outline';
  big?: boolean;
  /** What a screen reader says, e.g. "Choose an offer: Fix a fan". */
  a11y?: string;
}) {
  const t = useTheme();
  const filled = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flex: big ? 1 : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: big ? 13 : 8,
        paddingHorizontal: big ? 12 : 14,
        borderRadius: big ? 14 : 10,
        backgroundColor: filled ? t.colors.btn : kind === 'quiet' ? t.colors.surface2 : t.colors.surface,
        borderWidth: filled ? 0 : 1,
        borderColor: kind === 'outline' ? t.colors.accentBorder : t.colors.line,
        opacity: hovered ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <RNText numberOfLines={1} style={tx('800', big ? 14 : 13, filled ? t.colors.onBtn : kind === 'outline' ? t.colors.accentDeep : t.colors.ink)}>
        {label}
      </RNText>
    </Pressable>
  );
}

/** The tinted "Next step" box: one sentence, with the deadline when there is one. */
export function NextStepBox({ tone, label, children }: { tone: BoxTone; label?: string; children: React.ReactNode }) {
  const c = useToneSet(tone);
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 }}>
      {label ? <RNText style={tx('800', 10, c.fg, { letterSpacing: 1.2, marginBottom: 4 })}>{label}</RNText> : null}
      <RNText style={tx('500', 13, c.fg, { lineHeight: 19 })}>{children}</RNText>
    </View>
  );
}

/** A round initial for a person (no photo is loaded in these lists). */
export function Initial({ name, size = 36 }: { name: string | null | undefined; size?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <RNText style={tx('800', size * 0.4, t.colors.ink)}>{(name || '?').charAt(0).toUpperCase()}</RNText>
    </View>
  );
}

/** A square icon tile in a tone (the "Needs you now" rows, the desktop table's task column). */
export function IconTile({ icon, tone, size = 36 }: { icon: IconName; tone: BoxTone; size?: number }) {
  const c = useToneSet(tone);
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={size * 0.47} color={c.fg} strokeWidth={1.9} />
    </View>
  );
}

/** The ⋯ card menu button: an 18 px icon with a 42 px tap area on the web too (W2-1). */
export function DotsButton({ onPress, boxed = false }: { onPress: () => void; boxed?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={boxed ? 4 : 12}
      accessibilityRole="button"
      accessibilityLabel="Task options"
      style={
        boxed
          ? { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface }
          : undefined
      }
    >
      {boxed ? null : <HitArea x={12} y={12} />}
      <Icon name="dots" size={18} color={t.colors.muted} strokeWidth={2.4} />
    </Pressable>
  );
}

/** A small round chat button on hired work (chat is only open once an offer is accepted). */
export function ChatButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Chat"
      style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface }}
    >
      <Icon name="chat" size={16} color={t.colors.accentDeep} />
    </Pressable>
  );
}

/** The poster's 5-step track: thin segments with the step names under them, the current one in bold. */
export function SegmentTrack({ stages, stage, compact = false }: { stages: readonly string[]; stage: number; compact?: boolean }) {
  const t = useTheme();
  const name = stage > 0 ? stages[stage - 1] : 'Closed';
  return (
    <View accessible accessibilityLabel={stage > 0 ? `Step ${stage} of ${stages.length}: ${name}` : 'Closed'}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {stages.map((s, k) => (
          <View key={s} style={{ flex: 1, height: compact ? 4 : 3, borderRadius: 2, backgroundColor: k < stage ? t.colors.accent : t.colors.line }} />
        ))}
      </View>
      {compact ? (
        <RNText style={tx('700', 12.5, stage > 0 ? t.colors.ink : t.colors.muted, { marginTop: 7 })}>{name}</RNText>
      ) : (
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 5 }}>
          {stages.map((s, k) => (
            <RNText key={s} numberOfLines={1} style={tx(k === stage - 1 ? '800' : '500', 10, k === stage - 1 ? t.colors.ink : t.colors.muted, { flex: 1 })}>
              {s}
            </RNText>
          ))}
        </View>
      )}
    </View>
  );
}

/** The worker's track: dots joined by a line, ticked up to the step reached (MyWork board). */
export function DotTrack({ stages, stage }: { stages: readonly string[]; stage: number }) {
  const t = useTheme();
  return (
    <View accessible accessibilityLabel={`Step ${stage} of ${stages.length}: ${stages[Math.max(0, stage - 1)]}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {stages.map((s, k) => {
          const on = k < stage;
          return (
            <View key={s} style={{ flex: 1, alignItems: 'center' }}>
              {/* The line runs from the middle of one dot to the middle of the next. */}
              {k > 0 ? <View style={{ position: 'absolute', left: 0, right: '50%', top: 8, height: 2, backgroundColor: on ? t.colors.accent : t.colors.line }} /> : null}
              {k < stages.length - 1 ? (
                <View style={{ position: 'absolute', left: '50%', right: 0, top: 8, height: 2, backgroundColor: k + 1 < stage ? t.colors.accent : t.colors.line }} />
              ) : null}
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: on ? t.colors.accent : t.colors.surface,
                  borderWidth: on ? 0 : 1.5,
                  borderColor: t.colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on ? <Icon name="check" size={11} color={t.colors.onAccent} strokeWidth={3} /> : null}
              </View>
              <RNText numberOfLines={1} style={tx(on ? '700' : '500', 10, on ? t.colors.ink : t.colors.muted, { marginTop: 5 })}>
                {s}
              </RNText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** The desktop page header's button (right of the title): "Post a request" on Hire, "Offer a service" on Earn. */
export function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 40,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: t.colors.btn,
        opacity: hovered ? 0.93 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Icon name="plus" size={16} color={t.colors.onBtn} strokeWidth={2.4} />
      <RNText style={tx('700', 14, t.colors.onBtn)}>{label}</RNText>
    </Pressable>
  );
}
