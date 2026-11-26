import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';
import { Icon } from './Icon';
import { Shimmer } from './kit';
import { cardSurface } from './ui';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import type { SearchChip, SearchFallbacks, SearchSuggestion } from '../data/api';
import {
  WIDER_KM,
  closeMatchesLabel,
  countLabel,
  emptyTitle,
  loadingLine,
  suggestionCount,
  type SearchRole,
} from '../lib/smartSearch';

/**
 * The pieces of smart search (plan 1.19 row D), one set for the phone and the web. Earn (looking for jobs) is
 * always royal blue, Hire (looking for helpers) always jade, guests too. The words and counts come from
 * lib/smartSearch.ts and the api's searchSuggest / searchFallbacks.
 */

/** The side's colours: Earn = the blue tokens, Hire = the jade ones. */
export function useRoleColors(role: SearchRole) {
  const { colors: c } = useTheme();
  return role === 'earn'
    ? { solid: c.purple, deep: c.purpleDeep, soft: c.purpleSoft, border: c.purple }
    : { solid: c.accent, deep: c.accentDeep, soft: c.accentSoft, border: c.accentBorder };
}

/** "Searching for" + one pill per thing understood; the x drops it and runs the search again. */
export function SearchUnderstood({ role, chips, onDrop }: { role: SearchRole; chips: readonly SearchChip[]; onDrop: (id: string) => void }) {
  const t = useTheme();
  const rc = useRoleColors(role);
  if (chips.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 }}>
      <RNText style={tx('600', 12, t.colors.muted)}>Searching for</RNText>
      {chips.map((chip) => (
        <View
          key={chip.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: rc.soft,
            borderWidth: 1,
            borderColor: rc.border,
            borderRadius: 999,
            paddingVertical: 5,
            paddingLeft: 11,
            paddingRight: 7,
          }}
        >
          <RNText style={tx('700', 12.5, rc.deep)}>{chip.label}</RNText>
          <Pressable
            onPress={() => onDrop(chip.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Stop searching for ${chip.label}`}
          >
            <Icon name="close" size={13} color={rc.deep} strokeWidth={2.2} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/** Why a result matched, small and muted, with a dot in the side's colour. Nothing when the server said nothing. */
export function WhyLine({ role, why }: { role: SearchRole; why?: string | null }) {
  const t = useTheme();
  const rc = useRoleColors(role);
  if (!why) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: rc.solid }} />
      <RNText style={tx('500', 11.5, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
        {why}
      </RNText>
    </View>
  );
}

/** `Typed "plumbr"? Showing results for plumber.` and a way back to the exact spelling. */
export function TypoNote({ role, typed, corrected, onExact }: { role: SearchRole; typed: string; corrected: string | null; onExact: () => void }) {
  const t = useTheme();
  const rc = useRoleColors(role);
  if (!corrected) return null;
  return (
    <View
      style={{
        marginTop: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: t.colors.line,
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 12,
        gap: 4,
      }}
    >
      <RNText style={tx('500', 12.5, t.colors.muted)}>
        Typed “{typed}”? Showing results for <RNText style={tx('800', 12.5, rc.deep)}>{corrected}</RNText>.
      </RNText>
      <Pressable onPress={onExact} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Search for ${typed} instead`}>
        <RNText style={tx('700', 12.5, rc.deep)}>Search for {typed} instead</RNText>
      </Pressable>
    </View>
  );
}

/** While typing: what you may mean (up to three, with counts) and the last five searches on this device. */
export function LooksLikeYouMean({
  role,
  suggestions,
  hasArea,
  recent,
  onPick,
}: {
  role: SearchRole;
  suggestions: readonly SearchSuggestion[];
  hasArea: boolean;
  recent: readonly string[];
  onPick: (q: string) => void;
}) {
  const t = useTheme();
  const rc = useRoleColors(role);
  const shown = suggestions.slice(0, 3);
  const noun = role === 'earn' ? 'jobs' : 'helpers';
  const label = (text: string) => <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 14, marginBottom: 8 })}>{text}</RNText>;
  if (shown.length === 0 && recent.length === 0) return null;
  return (
    <View>
      {shown.length > 0 ? (
        <>
          {label('LOOKS LIKE YOU MEAN')}
          <View style={{ ...cardSurface(t, 14), overflow: 'hidden' }}>
            {shown.map((s, i) => {
              const right = suggestionCount(s.count, i === 0, hasArea);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => onPick(s.label)}
                  accessibilityRole="button"
                  accessibilityLabel={`Search ${s.label} ${noun}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: t.colors.line,
                    backgroundColor: pressed ? t.colors.surface2 : 'transparent',
                  })}
                >
                  <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: rc.soft, alignItems: 'center', justifyContent: 'center' }}>
                    <RNText style={tx('800', 13, rc.deep)}>{s.label.charAt(0).toUpperCase()}</RNText>
                  </View>
                  <RNText style={tx('600', 14, t.colors.ink, { flex: 1 })} numberOfLines={1}>
                    {s.label} {noun}
                  </RNText>
                  {right ? <RNText style={tx('600', 12.5, t.colors.muted)}>{right}</RNText> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
      {recent.length > 0 ? (
        <>
          {label('RECENT SEARCHES')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {recent.map((r) => (
              <Pressable
                key={r}
                onPress={() => onPick(r)}
                accessibilityRole="button"
                accessibilityLabel={`Search ${r} again`}
                style={{ borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}
              >
                <RNText style={tx('600', 12.5, t.colors.text)}>{r}</RNText>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** The search is running: a small spinner and line, then three grey cards. */
export function SearchLoading({ role, cardHeight = 120 }: { role: SearchRole; cardHeight?: number }) {
  const t = useTheme();
  const rc = useRoleColors(role);
  return (
    <View accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <ActivityIndicator size="small" color={rc.solid} />
        <RNText style={tx('600', 13, t.colors.muted)}>{loadingLine(role)}</RNText>
      </View>
      {[0, 1, 2].map((i) => (
        <Shimmer key={i} height={cardHeight} style={{ marginTop: 12 }} />
      ))}
    </View>
  );
}

function FallbackRow({ label, right, onPress, last }: { label: string; right: string; onPress: () => void; last: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.colors.line,
        backgroundColor: pressed ? t.colors.surface2 : 'transparent',
      })}
    >
      <RNText style={tx('600', 14, t.colors.ink, { flex: 1 })} numberOfLines={2}>
        {label}
      </RNText>
      <RNText style={tx('700', 13, t.colors.muted)}>{right}</RNText>
    </Pressable>
  );
}

/** Nothing found: what to try instead (wider area, remote jobs, close matches), each one tap. */
export function SearchEmpty({
  role,
  query,
  chipLabel,
  km,
  fallbacks,
  onWider,
  onRemote,
  onRelated,
}: {
  role: SearchRole;
  query: string;
  chipLabel?: string | null;
  /** The radius searched; null with no area. */
  km: number | null;
  fallbacks: SearchFallbacks | null;
  onWider: (km: number) => void;
  /** Earn only. */
  onRemote?: () => void;
  onRelated: (q: string) => void;
}) {
  const t = useTheme();
  const rc = useRoleColors(role);
  const rows: { key: string; label: string; right: string; onPress: () => void }[] = [];
  if (fallbacks?.wider) {
    const w = fallbacks.wider;
    rows.push({ key: 'wider', label: `Search within ${w.km || WIDER_KM} km`, right: countLabel(w.count, role), onPress: () => onWider(w.km || WIDER_KM) });
  }
  if (role === 'earn' && onRemote) rows.push({ key: 'remote', label: 'Show remote jobs too', right: '→', onPress: onRemote });
  if (fallbacks?.related) {
    const r = fallbacks.related;
    rows.push({ key: 'related', label: closeMatchesLabel(r.labels), right: countLabel(r.count, role), onPress: () => onRelated(r.q) });
  }
  return (
    <View style={{ alignItems: 'center', paddingTop: 28, paddingBottom: 8 }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: rc.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="search" size={28} color={rc.deep} strokeWidth={1.8} />
      </View>
      <RNText style={tx('800', 17, t.colors.ink, { textAlign: 'center', marginTop: 16, letterSpacing: -0.3 })}>
        {emptyTitle({ role, chipLabel, query, km })}
      </RNText>
      <RNText style={tx('400', 13, t.colors.muted, { textAlign: 'center', marginTop: 6, lineHeight: 19 })}>
        None posted near you right now. Try a wider area, or look at close matches.
      </RNText>
      {rows.length > 0 ? (
        <View style={{ ...cardSurface(t, 14), alignSelf: 'stretch', marginTop: 18, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <FallbackRow key={r.key} label={r.label} right={r.right} onPress={r.onPress} last={i === rows.length - 1} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

