import { useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { Icon, type IconName } from './Icon';
import { FadeIn, tx } from './primitives';
import { rupees } from './kit';
import { useTheme } from '../providers/ThemeProvider';
import { CREW_MAX, crewShareMinor, crewSizeFrom, type OptionKey, type Suggestion } from '../lib/posterOptions';
import type { Regular } from '../data/api';

/**
 * The Options step of posting (owner, 2026-11-01): the extras a poster can
 * switch on for this task. A few are suggested on top, each with its reason in
 * the poster's own words; the rest wait under "More options". Nothing is on
 * until the poster turns it on, and the server checks every one again.
 */

export type PosterOptions = {
  flash: boolean;
  liveAnswer: boolean;
  /** 0 = off; otherwise how many helpers, 2 to 10. */
  crewSize: number;
  repeat: 'week' | 'month' | null;
  preferWorker: { id: string; name: string } | null;
  wantPhotos: boolean;
  photosPublic: boolean;
};

export const NO_OPTIONS: PosterOptions = {
  flash: false,
  liveAnswer: false,
  crewSize: 0,
  repeat: null,
  preferWorker: null,
  wantPhotos: false,
  photosPublic: false,
};

export { CREW_MAX };

/** Whether an option is on. */
export function isOn(o: PosterOptions, key: OptionKey): boolean {
  switch (key) {
    case 'flash':
      return o.flash;
    case 'liveAnswer':
      return o.liveAnswer;
    case 'crew':
      return o.crewSize >= 2;
    case 'repeat':
      return o.repeat !== null;
    case 'regular':
      return o.preferWorker !== null;
    case 'photos':
      return o.wantPhotos;
  }
}

/** The options that are on, as short words for the Review step. */
export function optionsSummary(o: PosterOptions): string[] {
  const out: string[] = [];
  if (o.flash) out.push('Flash Drop');
  if (o.liveAnswer) out.push('Live answer');
  if (o.crewSize >= 2) out.push(`Crew of ${o.crewSize}`);
  if (o.repeat) out.push(o.repeat === 'week' ? 'Repeats weekly' : 'Repeats monthly');
  if (o.preferWorker) out.push(`${o.preferWorker.name} first`);
  if (o.wantPhotos) out.push(o.photosPublic ? 'Photos, may be shown' : 'Before and after photos');
  return out;
}

const META: Record<OptionKey, { title: string; icon: IconName; what: string; tone: 'signal' | 'accent' | 'purple' }> = {
  flash: { title: 'Flash Drop', icon: 'bolt', what: 'The first helper nearby to accept gets it, within 30 minutes', tone: 'signal' },
  crew: { title: 'Get a crew', icon: 'users', what: 'Several helpers, the budget split evenly, one shared chat', tone: 'accent' },
  regular: { title: 'Offer to someone you hired first', icon: 'heart', what: 'They get 10 minutes to say yes, then everyone sees it', tone: 'purple' },
  repeat: { title: 'Repeat it', icon: 'repeat', what: 'When it is done, the next one is posted by itself', tone: 'accent' },
  photos: { title: 'Before-and-after photos', icon: 'camera', what: 'The helper sends both with their proof of work', tone: 'accent' },
  liveAnswer: { title: 'Live answer', icon: 'eye', what: 'Someone nearby sends a live photo and a short reply', tone: 'accent' },
};

/**
 * What the step offers. Repeat, Offer-first and Before-and-after photos were
 * taken off (owner, 2026-11-02); Offer-first still shows when "Book again"
 * arrives with someone chosen, so the poster can see it and switch it off.
 */
const ALL: OptionKey[] = ['flash', 'crew', 'liveAnswer'];

export function PosterOptionsStep({
  value,
  onChange,
  suggestions,
  regulars,
  prompt,
  remote,
  priceMinor,
}: {
  value: PosterOptions;
  onChange: (next: PosterOptions) => void;
  suggestions: Suggestion[];
  regulars: Regular[];
  prompt: string;
  remote: boolean;
  /** The posted budget, for the crew split. */
  priceMinor: number;
}) {
  const t = useTheme();
  const suggested = suggestions.map((s) => s.key);
  // Kept for the whole visit, so switching Offer-first off does not hide it.
  const [bookedAgain] = useState(value.preferWorker !== null);
  const offered: OptionKey[] = bookedAgain ? ['regular', ...ALL] : ALL;
  const rest = offered.filter((k) => !suggested.includes(k));
  const [moreOpen, setMoreOpen] = useState(suggested.length === 0);

  /** Why an option cannot be used for this task, or null. */
  const blocked = (key: OptionKey): string | null => {
    if (remote && (key === 'flash' || key === 'crew' || key === 'liveAnswer')) return 'For jobs at a place';
    if (key === 'crew' && value.liveAnswer) return 'A Live answer is for one person';
    if (key === 'liveAnswer' && value.crewSize >= 2) return 'Not with a crew';
    return null;
  };

  const toggle = (key: OptionKey) => {
    const on = isOn(value, key);
    switch (key) {
      case 'flash':
        return onChange({ ...value, flash: !on });
      case 'liveAnswer':
        return onChange({ ...value, liveAnswer: !on });
      case 'crew':
        return onChange({ ...value, crewSize: on ? 0 : crewSizeFrom(prompt) });
      case 'regular': {
        // Shown only once "Book again" chose someone; it can switch back on after being switched off.
        const pick = regulars[0]?.profile;
        return onChange({ ...value, preferWorker: on || !pick ? null : { id: pick.id, name: pick.display_name } });
      }
    }
  };

  const settings = (key: OptionKey) => {
    if (!isOn(value, key)) return null;
    if (key === 'crew') {
      const share = crewShareMinor(priceMinor, value.crewSize);
      return (
        <View style={{ marginTop: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.colors.bg, borderRadius: 14, padding: 10 }}>
            <RNText style={tx('700', 13, t.colors.ink, { flex: 1 })}>How many helpers?</RNText>
            <Stepper
              value={value.crewSize}
              min={2}
              max={CREW_MAX}
              onChange={(n) => onChange({ ...value, crewSize: n })}
            />
          </View>
          <RNText style={tx('600', 12, t.colors.accentDeep)}>
            Your {rupees(priceMinor / 100)} budget is split: {rupees(share / 100)} each
          </RNText>
        </View>
      );
    }
    if (key === 'regular' && regulars.length > 1) {
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {regulars.slice(0, 6).map((r) => (
            <Chip
              key={r.profile.id}
              text={r.profile.display_name}
              on={value.preferWorker?.id === r.profile.id}
              onPress={() => onChange({ ...value, preferWorker: { id: r.profile.id, name: r.profile.display_name } })}
            />
          ))}
        </View>
      );
    }
    if (key === 'flash') {
      return (
        <RNText style={tx('500', 12, t.colors.signalDeep, { marginTop: 10, lineHeight: 17 })}>
          Uses Auto-hire: the first offer at or under your price is accepted and paid from your wallet, held safely
          until you approve.
        </RNText>
      );
    }
    return null;
  };

  const optionCard = (key: OptionKey, index: number, reason?: string) => {
    const meta = META[key];
    const on = isOn(value, key);
    const why = blocked(key);
    const title = key === 'regular' && value.preferWorker ? `Offer to ${value.preferWorker.name} first` : meta.title;
    const tint =
      meta.tone === 'signal'
        ? { bg: t.colors.signalSoft, fg: t.colors.signalDeep }
        : meta.tone === 'purple'
          ? { bg: t.colors.purpleSoft, fg: t.colors.purpleDeep }
          : { bg: t.colors.accentSoft, fg: t.colors.accentDeep };
    return (
      <FadeIn key={key} translateY={10} delay={Math.min(index, t.motion.staggerMax) * t.motion.stagger}>
        <View
          style={{
            padding: 14,
            borderRadius: 18,
            borderWidth: 1.5,
            borderColor: on ? t.colors.accentBorder : t.colors.line,
            backgroundColor: t.colors.surface,
            opacity: why && !on ? 0.6 : 1,
          }}
        >
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={meta.icon} size={19} color={tint.fg} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <RNText style={tx('800', 15, t.colors.ink)}>{title}</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })}>
                {why && !on ? why : reason || meta.what}
              </RNText>
              {reason && !why ? (
                <RNText style={tx('600', 12, t.colors.text, { marginTop: 3, lineHeight: 17 })}>{meta.what}</RNText>
              ) : null}
            </View>
            <Switch on={on} disabled={!!why && !on} label={title} onPress={() => toggle(key)} />
          </View>
          {settings(key)}
        </View>
      </FadeIn>
    );
  };

  return (
    <>
      <RNText style={tx('800', 27, t.colors.ink, { letterSpacing: -0.8, lineHeight: 32 })}>Make it go smoothly</RNText>
      <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
        {suggestions.length ? 'Picked for your task. Switch it on if you need it.' : 'Extras you can switch on for this task. All optional.'}
      </RNText>
      {prompt.trim() ? (
        <View style={{ marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: t.colors.surface2 }}>
          <RNText style={tx('500', 13, t.colors.text, { lineHeight: 19 })} numberOfLines={3}>
            “{prompt.trim()}”
          </RNText>
        </View>
      ) : null}

      {suggestions.length ? (
        <>
          <RNText style={tx('700', 11, t.colors.accentDeep, { letterSpacing: 1.2, marginTop: 22, marginBottom: 10 })}>
            SUGGESTED FOR YOU
          </RNText>
          <View style={{ gap: 10 }}>{suggestions.map((s, i) => optionCard(s.key, i, s.reason))}</View>
        </>
      ) : null}

      <Pressable
        onPress={() => setMoreOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginTop: 16,
          padding: 13,
          borderRadius: 16,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: t.colors.line,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View style={{ flex: 1 }}>
          <RNText style={tx('700', 14, t.colors.ink)}>More options</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
            {rest.map((k) => META[k].title).join(' · ')}
          </RNText>
        </View>
        <View style={{ transform: [{ rotate: moreOpen ? '-90deg' : '90deg' }] }}>
          <Icon name="chevronRight" size={16} color={t.colors.muted} />
        </View>
      </Pressable>
      {moreOpen ? <View style={{ gap: 10, marginTop: 10 }}>{rest.map((k, i) => optionCard(k, i))}</View> : null}
    </>
  );
}

function Switch({ on, disabled, label, onPress }: { on: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled }}
      hitSlop={8}
      style={{
        width: 48,
        height: 28,
        borderRadius: 999,
        padding: 3,
        backgroundColor: on ? t.colors.accent : t.colors.line,
        justifyContent: 'center',
        alignItems: on ? 'flex-end' : 'flex-start',
      }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 22, backgroundColor: t.colors.surface }} />
    </Pressable>
  );
}

function Chip({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 13,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: on ? t.colors.accent : t.colors.line,
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
      }}
    >
      <RNText style={tx(on ? '700' : '600', 13, on ? t.colors.accentDeep : t.colors.text)}>{text}</RNText>
    </Pressable>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  const t = useTheme();
  const btn = (icon: IconName, label: string, next: number, enabled: boolean) => (
    <Pressable
      onPress={() => enabled && onChange(next)}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 34,
        height: 34,
        borderRadius: 34,
        borderWidth: 1,
        borderColor: t.colors.line,
        backgroundColor: t.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: enabled ? 1 : 0.4,
      }}
    >
      <Icon name={icon} size={15} color={t.colors.ink} strokeWidth={2.4} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {btn('minus', 'Fewer helpers', value - 1, value > min)}
      <RNText style={tx('800', 18, t.colors.ink, { minWidth: 20, textAlign: 'center', fontVariant: ['tabular-nums'] })}>{value}</RNText>
      {btn('plus', 'More helpers', value + 1, value < max)}
    </View>
  );
}
