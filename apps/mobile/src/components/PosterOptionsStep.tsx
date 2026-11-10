import { useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { Icon, type IconName } from './Icon';
import { FadeIn, tx } from './primitives';
import { rupees } from './kit';
import { useTheme } from '../providers/ThemeProvider';
import { CREW_MAX, crewShareMinor, crewSizeFrom, type OptionKey, type Suggestion } from '../lib/posterOptions';
import { HUNT_NEEDS, HUNT_WINDOWS, defaultNeeds, needsFor, type HuntNeed, type HuntWindow } from '../lib/hunt';
import type { Regular } from '../data/api';
import { HuntHelpLink } from './Hunt';

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
  /** City Hunt (D19): how long it runs and what a find must show; null = off. The reward is the task's price. */
  hunt: { window: HuntWindow; needs: HuntNeed[] } | null;
};

export const NO_OPTIONS: PosterOptions = {
  flash: false,
  liveAnswer: false,
  crewSize: 0,
  repeat: null,
  preferWorker: null,
  wantPhotos: false,
  photosPublic: false,
  hunt: null,
};

/** The options a Hunt cannot be combined with (the server refuses them too). */
export const NOT_WITH_HUNT: OptionKey[] = ['flash', 'crew', 'liveAnswer', 'repeat', 'regular'];

/** A Hunt switched on with its starting choices: 2 hours, and the parts that suit where the work is. */
export function huntOn(o: PosterOptions, remote: boolean): PosterOptions {
  return {
    ...o,
    flash: false,
    liveAnswer: false,
    crewSize: 0,
    repeat: null,
    preferWorker: null,
    hunt: { window: '2h', needs: defaultNeeds(remote) },
  };
}

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
    case 'hunt':
      return o.hunt !== null;
  }
}

/** The options that are on, as short words for the Review step. */
export function optionsSummary(o: PosterOptions): string[] {
  const out: string[] = [];
  if (o.hunt) out.push(`Hunt · ${HUNT_WINDOWS.find((w) => w.key === o.hunt!.window)?.label ?? ''}`);
  if (o.flash) out.push('Flash Drop');
  if (o.liveAnswer) out.push('Live answer');
  if (o.crewSize >= 2) out.push(`Crew of ${o.crewSize}`);
  if (o.repeat) out.push(o.repeat === 'week' ? 'Repeats weekly' : 'Repeats monthly');
  if (o.preferWorker) out.push(`${o.preferWorker.name} first`);
  if (o.wantPhotos) out.push(o.photosPublic ? 'Photos, may be shown' : 'Before and after photos');
  return out;
}

const META: Record<OptionKey, { title: string; icon: IconName; what: string; tone: 'signal' | 'accent' | 'purple' | 'gold' }> = {
  hunt: { title: 'Make it a Hunt', icon: 'search', what: 'Many people look at once. Pay only the person who finds it', tone: 'gold' },
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
const ALL: OptionKey[] = ['hunt', 'flash', 'crew', 'liveAnswer'];

export function PosterOptionsStep({
  value,
  onChange,
  suggestions,
  regulars,
  prompt,
  remote,
  priceMinor,
  onHuntHelp,
}: {
  value: PosterOptions;
  onChange: (next: PosterOptions) => void;
  suggestions: Suggestion[];
  regulars: Regular[];
  prompt: string;
  remote: boolean;
  /** The posted budget, for the crew split. */
  priceMinor: number;
  /** Opens the "How a Hunt works" sheet; the link shows inside the Hunt's settings. */
  onHuntHelp?: () => void;
}) {
  const t = useTheme();
  const suggested = suggestions.map((s) => s.key);
  // Kept for the whole visit, so switching Offer-first off does not hide it.
  const [bookedAgain] = useState(value.preferWorker !== null);
  // Who was chosen when this step opened ("Book again", or a service listing's owner who is not a
  // regular), so Offer-first can be switched back on for them after being switched off.
  const [firstPick] = useState(value.preferWorker);
  const offered: OptionKey[] = bookedAgain ? ['regular', ...ALL] : ALL;
  const rest = offered.filter((k) => !suggested.includes(k));
  const [moreOpen, setMoreOpen] = useState(suggested.length === 0);

  /** Why an option cannot be used for this task, or null. */
  const blocked = (key: OptionKey): string | null => {
    if (key !== 'hunt' && value.hunt && NOT_WITH_HUNT.includes(key)) return 'Not with a Hunt';
    if (key === 'hunt' && (value.flash || value.crewSize >= 2 || value.liveAnswer || value.repeat || value.preferWorker)) {
      return 'Not with Flash Drop, a crew, Live answer, Repeat or a regular';
    }
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
      case 'hunt':
        return onChange(on ? { ...value, hunt: null } : huntOn(value, remote));
      case 'crew':
        return onChange({ ...value, crewSize: on ? 0 : crewSizeFrom(prompt) });
      case 'regular': {
        // Shown only once "Book again" chose someone; it can switch back on after being switched off.
        const first = regulars[0]?.profile;
        const pick = firstPick ?? (first ? { id: first.id, name: first.display_name } : null);
        return onChange({ ...value, preferWorker: on || !pick ? null : pick });
      }
    }
  };

  const settings = (key: OptionKey) => {
    if (!isOn(value, key)) return null;
    if (key === 'hunt' && value.hunt) {
      const hunt = value.hunt;
      const label = (text: string) => (
        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 0.6, marginTop: 14 })}>{text}</RNText>
      );
      const offered = HUNT_NEEDS.filter((n) => !(remote && n.key === 'pin'));
      return (
        <View>
          {label('REWARD FOR THE FINDER')}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <View
              style={{
                flex: 1,
                height: 48,
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: t.colors.gold,
                backgroundColor: t.colors.bg,
                justifyContent: 'center',
                paddingHorizontal: 14,
              }}
            >
              <RNText style={tx('800', 20, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(priceMinor / 100)}</RNText>
            </View>
            <RNText style={tx('500', 12, t.colors.muted, { width: 130, lineHeight: 17 })}>
              Your price. You pay only when you accept a find
            </RNText>
          </View>
          {label('FIND IT WITHIN')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {HUNT_WINDOWS.map((w) => (
              <GoldPill
                key={w.key}
                text={w.label}
                on={hunt.window === w.key}
                onPress={() => onChange({ ...value, hunt: { ...hunt, window: w.key } })}
              />
            ))}
          </View>
          {label('A FIND MUST SHOW')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {offered.map((n) => {
              const on = hunt.needs.includes(n.key);
              return (
                <GoldPill
                  key={n.key}
                  text={`${on ? '✓' : '+'} ${n.label}`}
                  on={on}
                  onPress={() => {
                    const next = on ? hunt.needs.filter((k) => k !== n.key) : [...hunt.needs, n.key];
                    // At least one part, like the server.
                    if (next.length > 0) onChange({ ...value, hunt: { ...hunt, needs: needsFor(next, remote) } });
                  }}
                />
              );
            })}
          </View>
          <RNText style={tx('500', 12, t.colors.goldInk, { marginTop: 12, lineHeight: 17 })}>
            Nothing is taken now. You pay only when you tap This is it. Nothing found, nothing paid.
          </RNText>
          {onHuntHelp ? <HuntHelpLink onPress={onHuntHelp} marginTop={8} /> : null}
        </View>
      );
    }
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
          : meta.tone === 'gold'
            ? { bg: t.colors.goldSoft, fg: t.colors.goldInk }
            : { bg: t.colors.accentSoft, fg: t.colors.accentDeep };
    const gold = meta.tone === 'gold';
    return (
      <FadeIn key={key} translateY={10} delay={Math.min(index, t.motion.staggerMax) * t.motion.stagger}>
        <View
          style={{
            padding: 14,
            borderRadius: 18,
            borderWidth: 1.5,
            borderColor: on ? (gold ? t.colors.gold : t.colors.accentBorder) : t.colors.line,
            backgroundColor: on && gold ? t.colors.goldSoft : t.colors.surface,
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
            <Switch on={on} gold={gold} disabled={!!why && !on} label={title} onPress={() => toggle(key)} />
          </View>
          {settings(key)}
        </View>
      </FadeIn>
    );
  };

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 6 }}>
        <RNText style={tx('800', 27, t.colors.ink, { letterSpacing: -0.8, lineHeight: 32 })}>Make it go smoothly</RNText>
        <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line }}>
          <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 0.4 })}>Optional</RNText>
        </View>
      </View>
      <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
        Optional. Most requests skip this — switch something on only if it helps.
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
            IF YOU LIKE
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

/** A choice inside the Hunt card: gold when chosen. */
function GoldPill({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({
        height: 34,
        borderRadius: 999,
        paddingHorizontal: 13,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: on ? t.colors.gold : t.colors.line,
        backgroundColor: on ? t.colors.goldSoft : t.colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <RNText style={tx('700', 13, on ? t.colors.goldInk : t.colors.text)}>{text}</RNText>
    </Pressable>
  );
}

function Switch({ on, gold, disabled, label, onPress }: { on: boolean; gold?: boolean; disabled?: boolean; label: string; onPress: () => void }) {
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
        backgroundColor: on ? (gold ? t.colors.gold : t.colors.accent) : t.colors.line,
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
