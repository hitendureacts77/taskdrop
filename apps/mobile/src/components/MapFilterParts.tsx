import { useEffect, useState } from 'react';
import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import { Slider } from './Slider';
import { rupees } from './kit';
import { Pressy, tx } from './primitives';
import { Segmented } from './NearMapParts';
import { DEFAULT_FILTERS, KM_STEPS, PAY_STEPS, SORT_LABELS, WORK_LABELS, type JobSort, type MapFilters, type WorkType } from '../lib/mapFilters';

/**
 * The Explore map's filter controls (plan D23, owner video 9 Nov): the place the search is around, the
 * In person / From home switch, small chips that say what is set, and one Filters sheet that holds
 * everything, with a button that says how many it will show.
 */

/** "Any pay" / "₹1,000+". */
export const payLabel = (minPay: number) => (minPay > 0 ? `${rupees(minPay)}+` : 'Any pay');

/** Where the map looks: your own area, or a place you picked (a city, an area). Tap to change it. */
export function PlaceRow({
  label,
  mine,
  onChange,
  onUseMine,
}: {
  label: string;
  /** True: it is your own area ("Near me"). False: a place you picked. */
  mine: boolean;
  onChange?: () => void;
  onUseMine?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressy
        onPress={onChange}
        disabled={!onChange}
        label={`${mine ? 'Near me' : 'Looking around'} ${label}${onChange ? '. Change the place' : ''}`}
        scaleTo={0.98}
        style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 14, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}
      >
        <Icon name={mine ? 'compass' : 'pin'} size={16} color={t.colors.ink} />
        <RNText style={tx('700', 13, t.colors.ink, { flex: 1, minWidth: 0 })} numberOfLines={1}>
          {mine ? 'Near me · ' : ''}
          {label}
        </RNText>
        {onChange ? <RNText style={tx('800', 12.5, t.colors.accentDeep)}>Change</RNText> : null}
      </Pressy>
      {!mine && onUseMine ? (
        <Pressy
          onPress={onUseMine}
          label="Back to my area"
          style={{ height: 44, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Icon name="compass" size={14} color={t.colors.ink} />
          <RNText style={tx('700', 12.5, t.colors.ink)}>My area</RNText>
        </Pressy>
      ) : null}
    </View>
  );
}

/** All / In person / From home, full width. */
export function WorkSwitch({ value, onChange }: { value: WorkType; onChange: (w: WorkType) => void }) {
  return (
    <Segmented
      grow
      label="Type of work"
      value={value}
      onChange={onChange}
      options={(['all', 'local', 'remote'] as WorkType[]).map((w) => ({ value: w, label: WORK_LABELS[w] }))}
    />
  );
}

/** A chip that says what is set ("10 km", "Any pay") and opens the Filters sheet; or a plain on/off chip. */
export function QuickChip({ label, onPress, on = false, open = false, dot }: { label: string; onPress: () => void; on?: boolean; open?: boolean; dot?: string }) {
  const t = useTheme();
  return (
    <Pressy
      onPress={onPress}
      label={open ? `${label}. Change` : label}
      style={{
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        ...(on ? { backgroundColor: t.colors.ink } : { backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line }),
      }}
    >
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <RNText style={tx(on ? '800' : '700', 12, on ? t.colors.bg : t.colors.ink)} numberOfLines={1}>
        {label}
      </RNText>
      {open ? (
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Icon name="chevronRight" size={11} color={on ? t.colors.bg : t.colors.text} />
        </View>
      ) : null}
    </Pressy>
  );
}

/** The Filters button, with how many filters are changed from the default. */
export function FiltersButton({ count, onPress }: { count: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressy
      onPress={onPress}
      label={count > 0 ? `Filters, ${count} on` : 'Filters'}
      style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.bg, borderWidth: 1, borderColor: count > 0 ? t.colors.ink : t.colors.line }}
    >
      <Icon name="filter" size={13} color={t.colors.ink} />
      <RNText style={tx('800', 12, t.colors.ink)}>Filters</RNText>
      {count > 0 ? (
        <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: t.colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('800', 10.5, t.colors.bg)}>{count}</RNText>
        </View>
      ) : null}
    </Pressy>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <RNText style={tx('800', 12.5, t.colors.muted)}>{title}</RNText>
      {children}
    </View>
  );
}

function Choices<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => (
        <QuickChip key={String(o.value)} label={o.label} on={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

/**
 * Everything in one place: where, how far, pay, type of work and order (jobs), or where and how far (helpers).
 * Nothing changes until "Show N jobs", which says how many the choice will show.
 */
export function FiltersPanel({
  initial,
  jobs,
  place,
  count,
  words,
  onApply,
}: {
  initial: MapFilters;
  /** The Jobs layer: pay, type of work and order too. */
  jobs: boolean;
  place: { label: string; mine: boolean; onChange?: () => void; onUseMine?: () => void };
  /** How many the draft would show. */
  count: (f: MapFilters) => number;
  words: { one: string; many: string };
  onApply: (f: MapFilters) => void;
}) {
  const t = useTheme();
  const [f, setF] = useState(initial);
  // Opened again: start from what is in use.
  useEffect(() => setF(initial), [initial]);
  const set = (part: Partial<MapFilters>) => setF((cur) => ({ ...cur, ...part }));
  const n = count(f);
  return (
    <View style={{ gap: 18 }}>
      <Section title="Where">
        <PlaceRow label={place.label} mine={place.mine} {...(place.onChange ? { onChange: place.onChange } : {})} {...(place.onUseMine ? { onUseMine: place.onUseMine } : {})} />
      </Section>
      {jobs && f.work === 'remote' ? null : (
        <Section title={`How far · ${f.km} km`}>
          <Slider value={f.km} min={1} max={100} onChange={(km) => set({ km: Math.round(km) })} accessibilityLabel="How far, in km" />
          <Choices options={KM_STEPS.map((k) => ({ value: k, label: `${k} km` }))} value={f.km} onChange={(km) => set({ km })} />
        </Section>
      )}
      {jobs ? (
        <>
          <Section title="Pay">
            <Choices options={PAY_STEPS.map((p) => ({ value: p, label: payLabel(p) }))} value={f.minPay} onChange={(minPay) => set({ minPay })} />
          </Section>
          <Section title="Type of work">
            <WorkSwitch value={f.work} onChange={(work) => set({ work })} />
          </Section>
          <Section title="Show first">
            <Choices options={(['pay', 'near', 'new'] as JobSort[]).map((s) => ({ value: s, label: SORT_LABELS[s] }))} value={f.sort} onChange={(sort) => set({ sort })} />
          </Section>
        </>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Pressy onPress={() => setF({ ...DEFAULT_FILTERS })} label="Reset filters" style={{ height: 48, paddingHorizontal: 18, borderRadius: 16, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('700', 14, t.colors.text)}>Reset</RNText>
        </Pressy>
        <Pressy
          onPress={() => onApply(f)}
          label={`Show ${n} ${n === 1 ? words.one : words.many}`}
          style={{ flex: 1, height: 48, borderRadius: 16, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}
        >
          <RNText style={tx('800', 15, t.colors.onBtn)}>
            {n === 0 ? `No ${words.many} yet · Show anyway` : `Show ${n} ${n === 1 ? words.one : words.many}`}
          </RNText>
        </Pressy>
      </View>
    </View>
  );
}
