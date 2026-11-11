import { useEffect, useState } from 'react';
import { View, Text as RNText, TextInput } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Slider } from './Slider';
import { Pressy, tx } from './primitives';
import { Segmented } from './NearMapParts';
import {
  DEFAULT_FILTERS,
  KM_STEPS,
  MAX_PRICE,
  PRICE_PRESETS,
  SORT_LABELS,
  WORK_LABELS,
  cleanPrice,
  dropOptions,
  hasPrice,
  priceLabel,
  type JobSort,
  type MapFilters,
  type WorkType,
} from '../lib/mapFilters';

/**
 * The Find work filter controls (plan D23, then D27 / task 1.17), the same on the map and the list: the place
 * the search is around, All / Nearby / Remote, chips that say what is set (each with an x), and one Filters
 * sheet that holds everything, with a button that says how many it will show. No category (owner, 11 Nov).
 */

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

/** All / Nearby / Remote, full width. */
export function WorkSwitch({ value, onChange }: { value: WorkType; onChange: (w: WorkType) => void }) {
  return (
    <Segmented
      grow
      label="Nearby or remote"
      value={value}
      onChange={onChange}
      options={(['all', 'local', 'remote'] as WorkType[]).map((w) => ({ value: w, label: WORK_LABELS[w] }))}
    />
  );
}

/** A chip that says what is set ("10 km", "Any price") and opens the Filters sheet; a plain on/off chip; or a set filter with an x. */
export function QuickChip({
  label,
  onPress,
  on = false,
  open = false,
  dot,
  locked = false,
  lockedHint = 'Locked. Opens a switch to the other mode',
  clear = false,
}: {
  label: string;
  onPress: () => void;
  on?: boolean;
  open?: boolean;
  dot?: string;
  /** The other mode's side: a lock before the label (plan D26). */
  locked?: boolean;
  lockedHint?: string;
  /** A set filter: an x after the label, and a tap takes it off. */
  clear?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressy
      onPress={onPress}
      label={locked ? `${label}. ${lockedHint}` : clear ? `${label}. Remove` : open ? `${label}. Change` : label}
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
      {locked ? <Icon name="lock" size={11} color={t.colors.muted} /> : null}
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <RNText style={tx(on ? '800' : '700', 12, on ? t.colors.bg : t.colors.ink)} numberOfLines={1}>
        {label}
      </RNText>
      {clear ? <Icon name="close" size={11} color={on ? t.colors.bg : t.colors.text} /> : null}
      {open ? (
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Icon name="chevronRight" size={11} color={on ? t.colors.bg : t.colors.text} />
        </View>
      ) : null}
    </Pressy>
  );
}

/**
 * The job filters that are set, one chip each with an x that takes it off (the order, once changed, too).
 * A fragment, so the map can wrap them and the list can scroll them sideways.
 */
export function JobChips({ filters: f, onChange }: { filters: MapFilters; onChange: (f: MapFilters) => void }) {
  const chips: { key: string; label: string; next: MapFilters }[] = [];
  if (hasPrice(f)) chips.push({ key: 'price', label: priceLabel(f), next: { ...f, minPay: 0, maxPay: 0 } });
  if (f.auto) chips.push({ key: 'auto', label: 'Auto-hire', next: { ...f, auto: false } });
  if (f.offers) chips.push({ key: 'offers', label: 'Open to offers', next: { ...f, offers: false } });
  if (f.dueSoon) chips.push({ key: 'due', label: 'Due in 24 h', next: { ...f, dueSoon: false } });
  if (f.sort !== 'pay') chips.push({ key: 'sort', label: `${SORT_LABELS[f.sort]} first`, next: { ...f, sort: 'pay' } });
  return (
    <>
      {chips.map((c) => (
        <QuickChip key={c.key} label={c.label} on clear onPress={() => onChange(c.next)} />
      ))}
    </>
  );
}

/**
 * Nothing (or little) matches: one button per filter that could be loosened, each saying how many jobs
 * it would then show. `count` measures a draft of the filters.
 */
export function DropFilters({ filters, count, onChange }: { filters: MapFilters; count: (f: MapFilters) => number; onChange: (f: MapFilters) => void }) {
  const t = useTheme();
  const options = dropOptions(filters)
    .map((o) => ({ ...o, n: count(o.next) }))
    .filter((o) => o.n > 0);
  if (options.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o, i) => (
        <Pressy
          key={o.key}
          onPress={() => onChange(o.next)}
          label={`${o.label}, shows ${o.n} ${o.n === 1 ? 'job' : 'jobs'}`}
          style={{
            height: 40,
            paddingHorizontal: 16,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            ...(i === 0 ? { backgroundColor: t.colors.btn } : { borderWidth: 1, borderColor: t.colors.line }),
          }}
        >
          <RNText style={tx(i === 0 ? '800' : '700', 13, i === 0 ? t.colors.onBtn : t.colors.ink)}>
            {o.label} · {o.n}
          </RNText>
        </Pressy>
      ))}
    </View>
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

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View>
        <RNText style={tx('800', 12.5, t.colors.muted)}>{title}</RNText>
        {hint ? <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })}>{hint}</RNText> : null}
      </View>
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

/** A price box: whole rupees, empty = open end. */
function PriceBox({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 14, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 6 }}>
      <RNText style={tx('700', 12, t.colors.muted)}>{label} ₹</RNText>
      <TextInput
        value={value > 0 ? String(value) : ''}
        onChangeText={(s) => {
          const n = Number(s.replace(/[^0-9]/g, ''));
          onChange(Number.isFinite(n) ? Math.min(MAX_PRICE, n) : 0);
        }}
        placeholder="Any"
        placeholderTextColor={t.colors.muted}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={7}
        accessibilityLabel={`${label} price in rupees`}
        style={[tx('700', 14, t.colors.ink, { fontVariant: ['tabular-nums'] }), { flex: 1, minWidth: 0, paddingVertical: 0 }]}
      />
    </View>
  );
}

/** An on/off card with a title and one line under it (more than one can be on). */
function Toggle({ icon, title, sub, on, onPress }: { icon: IconName; title: string; sub: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressy
      onPress={onPress}
      label={`${title}. ${sub}. ${on ? 'On' : 'Off'}`}
      scaleTo={0.98}
      style={{ flex: 1, minWidth: 150, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? t.colors.ink : t.colors.line, backgroundColor: t.colors.surface, padding: on ? 11 : 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
    >
      <Icon name={icon} size={16} color={t.colors.ink} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={tx('800', 13, t.colors.ink)}>{title}</RNText>
        <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })}>{sub}</RNText>
      </View>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: on ? 0 : 1.5, borderColor: t.colors.line, backgroundColor: on ? t.colors.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Icon name="check" size={12} color={t.colors.bg} /> : null}
      </View>
    </Pressy>
  );
}

/**
 * Everything in one place: where, Nearby or remote, how far, price, how they hire, due date and order (jobs),
 * or where and how far (helpers). Nothing changes until "Show N jobs", which says how many the choice will show.
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
  /** The Jobs layer: the job filters too. */
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
  // The boxes may hold a ceiling under the floor while typing; it is put right on Show.
  const ready = { ...f, ...cleanPrice(f.minPay, f.maxPay) };
  const n = count(ready);
  const preset = PRICE_PRESETS.findIndex((p) => p.min === f.minPay && p.max === f.maxPay);
  return (
    <View style={{ gap: 18 }}>
      <Section title="Where">
        <PlaceRow label={place.label} mine={place.mine} {...(place.onChange ? { onChange: place.onChange } : {})} {...(place.onUseMine ? { onUseMine: place.onUseMine } : {})} />
      </Section>
      {jobs ? (
        <Section title="Nearby or remote">
          <WorkSwitch value={f.work} onChange={(work) => set({ work })} />
        </Section>
      ) : null}
      {jobs && f.work === 'remote' ? null : (
        <Section title={`How far · ${f.km} km`}>
          <Slider value={f.km} min={1} max={100} onChange={(km) => set({ km: Math.round(km) })} accessibilityLabel="How far, in km" />
          <Choices options={KM_STEPS.map((k) => ({ value: k, label: `${k} km` }))} value={f.km} onChange={(km) => set({ km })} />
        </Section>
      )}
      {jobs ? (
        <>
          <Section title={`Price · ${priceLabel(ready)}`}>
            <Choices
              options={PRICE_PRESETS.map((p, i) => ({ value: i, label: priceLabel({ minPay: p.min, maxPay: p.max }) }))}
              value={preset}
              onChange={(i) => set({ minPay: PRICE_PRESETS[i]!.min, maxPay: PRICE_PRESETS[i]!.max })}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PriceBox label="Min" value={f.minPay} onChange={(minPay) => set({ minPay })} />
              <PriceBox label="Max" value={f.maxPay} onChange={(maxPay) => set({ maxPay })} />
            </View>
          </Section>
          <Section title="How they hire" hint="Pick one, both, or neither for all jobs">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Toggle icon="bolt" title="Auto-hire" sub="The first good offer gets the job" on={f.auto} onPress={() => set({ auto: !f.auto })} />
              <Toggle icon="gavel" title="Open to counter offers" sub="Send your own price" on={f.offers} onPress={() => set({ offers: !f.offers })} />
            </View>
          </Section>
          <Section title="When">
            <View style={{ flexDirection: 'row' }}>
              <Toggle icon="clock" title="Due in 24 hours" sub="Urgent jobs and ones due by tomorrow" on={f.dueSoon} onPress={() => set({ dueSoon: !f.dueSoon })} />
            </View>
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
          onPress={() => onApply(ready)}
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
