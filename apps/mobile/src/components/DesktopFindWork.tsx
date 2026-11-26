import { createElement, useState } from 'react';
import { View, Text as RNText, TextInput, Pressable, type TextInputInstance } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import { Slider } from './Slider';
import { Pressy, tx } from './primitives';
import {
  KM_STEPS,
  MAX_PRICE,
  PRICE_PRESETS,
  SORT_LABELS,
  WORK_LABELS,
  cleanPrice,
  priceLabel,
  type JobSort,
  type MapFilters,
  type WorkType,
} from '../lib/mapFilters';
import { wholeDigits, wholeText } from '../lib/rupeeInput';

/**
 * Desktop Find work (D31 web board WebFindWork): the pieces the list page puts around the jobs. Everything here
 * reads and writes the same MapFilters the map and the phone's filter sheet use (lib/jobFiltersStore); nothing
 * is a new filter. Desktop web only (the screen draws them when `useLayout().desktop`).
 */

/** The header's search bar: a compact field with the mic and a small go button. */
export function FindWorkSearch({
  value,
  onChange,
  onSubmit,
  placeholder,
  voice,
  inputRef,
  onFocusChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  voice?: { supported: boolean; listening: boolean; toggle: () => void };
  inputRef?: React.RefObject<TextInputInstance | null>;
  onFocusChange?: (focused: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 44,
        paddingLeft: 14,
        paddingRight: 5,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: t.colors.accentBorder,
        backgroundColor: t.colors.surface,
      }}
    >
      <Icon name="search" size={16} color={t.colors.muted} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        onFocus={onFocusChange ? () => onFocusChange(true) : undefined}
        onBlur={onFocusChange ? () => onFocusChange(false) : undefined}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={t.colors.muted}
        accessibilityLabel="Search jobs"
        style={[tx('400', 14, t.colors.ink), { flex: 1, minWidth: 0, paddingVertical: 0, outlineStyle: 'none' } as object]}
      />
      {voice?.supported ? (
        <Pressable onPress={voice.toggle} hitSlop={6} accessibilityRole="button" accessibilityLabel="Voice typing">
          <Icon name="mic" size={17} color={voice.listening ? t.colors.signal : t.colors.muted} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={onSubmit}
        accessibilityRole="button"
        accessibilityLabel="Go"
        style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="search" size={16} color={t.colors.onAccent} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

/** Tabs with an underline, the toolbar's left side (Jobs / Busy now / How it works). */
export function UnderTabs({ tabs, active, onPick }: { tabs: string[]; active: number; onPick: (i: number) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 22, borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
      {tabs.map((label, i) => {
        const on = i === active;
        return (
          <Pressable
            key={label}
            onPress={() => onPick(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ paddingVertical: 10, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: on ? t.colors.accent : 'transparent' }}
          >
            <RNText style={tx(on ? '800' : '600', 14, on ? t.colors.ink : t.colors.muted)}>{label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Sort  [Best pay v]": the live "show first" order (pay, nearest, newest), as a select. */
export function SortSelect({ value, onChange }: { value: JobSort; onChange: (s: JobSort) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <RNText style={tx('500', 13, t.colors.muted)}>Sort</RNText>
      {/* Desktop web only: a real select, so the keyboard and the browser's own list work. */}
      {createElement(
        'select',
        {
          value,
          'aria-label': 'Sort the jobs',
          onChange: (e: { target: { value: string } }) => onChange(e.target.value as JobSort),
          style: {
            height: 36,
            padding: '0 12px',
            borderRadius: 10,
            border: `1px solid ${t.colors.line}`,
            background: t.colors.surface,
            color: t.colors.ink,
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 700,
          },
        },
        (Object.keys(SORT_LABELS) as JobSort[]).map((s) => createElement('option', { key: s, value: s }, SORT_LABELS[s])),
      )}
    </View>
  );
}

function Group({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 10, marginTop: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <RNText style={tx('800', 11.5, t.colors.muted, { letterSpacing: 0.8 })} numberOfLines={1}>
          {title.toUpperCase()}
        </RNText>
        {right}
      </View>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressy
      onPress={onPress}
      label={label}
      scaleTo={0.97}
      style={{
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 17,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: on ? t.colors.accent : t.colors.line,
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
      }}
    >
      <RNText style={tx(on ? '800' : '600', 13, on ? t.colors.accentDeep : t.colors.ink)}>{label}</RNText>
    </Pressy>
  );
}

function Radio({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: on ? 5 : 1.5, borderColor: on ? t.colors.accent : t.colors.muted, backgroundColor: t.colors.surface }} />
      <RNText style={tx(on ? '700' : '500', 14, t.colors.ink)}>{label}</RNText>
    </Pressable>
  );
}

function Check({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
      <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: on ? 0 : 1.5, borderColor: t.colors.muted, backgroundColor: on ? t.colors.accent : t.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Icon name="check" size={12} color={t.colors.onAccent} strokeWidth={3} /> : null}
      </View>
      <RNText style={tx(on ? '700' : '500', 14, t.colors.ink)}>{label}</RNText>
    </Pressable>
  );
}

function PriceInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const t = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <View style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 10, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 4 }}>
      <RNText style={tx('600', 12, t.colors.muted)}>{label} ₹</RNText>
      <TextInput
        value={draft ?? (value > 0 ? String(value) : '')}
        onBlur={() => setDraft(null)}
        onChangeText={(s) => {
          const kept = wholeText(s, 7);
          setDraft(kept);
          const n = Number(wholeDigits(kept));
          onChange(Number.isFinite(n) ? Math.min(MAX_PRICE, n) : 0);
        }}
        placeholder="Any"
        placeholderTextColor={t.colors.muted}
        inputMode="numeric"
        maxLength={7}
        accessibilityLabel={`${label} price in rupees`}
        style={[tx('700', 13, t.colors.ink, { fontVariant: ['tabular-nums'] }), { flex: 1, minWidth: 0, paddingVertical: 0, outlineStyle: 'none' } as object]}
      />
    </View>
  );
}

/**
 * The 240 px Filters column: where (all / nearby / remote), how far from the area, price, how they hire, when.
 * The same options as the phone's Filters sheet (FiltersPanel); a change applies at once, as on the map's chips.
 */
export function FindWorkFilters({
  filters,
  onChange,
  onClear,
  clearable,
  area,
  onChangeArea,
}: {
  filters: MapFilters;
  onChange: (f: MapFilters) => void;
  onClear: () => void;
  /** Something is set (a filter or a search), so Clear does something. */
  clearable: boolean;
  /** The place the jobs are around; null when none is chosen yet. */
  area: string | null;
  onChangeArea?: () => void;
}) {
  const t = useTheme();
  const [custom, setCustom] = useState(false);
  const set = (part: Partial<MapFilters>) => onChange({ ...filters, ...part });
  const preset = PRICE_PRESETS.findIndex((p) => p.min === filters.minPay && p.max === filters.maxPay);
  const remote = filters.work === 'remote';
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="filter" size={15} color={t.colors.ink} />
          <RNText accessibilityRole="header" style={tx('800', 15, t.colors.ink)}>Filters</RNText>
        </View>
        <Pressable onPress={onClear} disabled={!clearable} accessibilityRole="button" accessibilityLabel="Clear all filters" hitSlop={8}>
          <RNText style={tx('700', 13, clearable ? t.colors.accentDeep : t.colors.muted)}>Clear</RNText>
        </Pressable>
      </View>

      <Group title="Where">
        <View style={{ flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: t.colors.surface2 }}>
          {(['all', 'local', 'remote'] as WorkType[]).map((w) => {
            const on = filters.work === w;
            return (
              <Pressable
                key={w}
                onPress={() => set({ work: w })}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={{ flex: 1, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.colors.surface : 'transparent' }}
              >
                <RNText style={tx(on ? '800' : '600', 13, on ? t.colors.ink : t.colors.muted)}>{WORK_LABELS[w]}</RNText>
              </Pressable>
            );
          })}
        </View>
      </Group>

      {remote ? null : (
        <Group
          title={area ? `Distance from ${area}` : 'Distance'}
          right={
            onChangeArea ? (
              <Pressable onPress={onChangeArea} accessibilityRole="button" accessibilityLabel="Change the place" hitSlop={8}>
                <RNText style={tx('700', 12, t.colors.accentDeep)}>Change</RNText>
              </Pressable>
            ) : undefined
          }
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {KM_STEPS.map((k) => (
              <Chip key={k} label={`${k} km`} on={filters.km === k} onPress={() => set({ km: k })} />
            ))}
          </View>
          <Pressable onPress={() => setCustom((c) => !c)} accessibilityRole="button" accessibilityState={{ expanded: custom }}>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>Custom distance{KM_STEPS.includes(filters.km) ? '' : ` · ${filters.km} km`}</RNText>
          </Pressable>
          {custom ? <Slider value={filters.km} min={1} max={100} onChange={(km) => set({ km: Math.round(km) })} accessibilityLabel="How far, in km" /> : null}
        </Group>
      )}

      <Group title="Price">
        <View>
          {PRICE_PRESETS.map((p, i) => (
            <Radio key={i} label={priceLabel({ minPay: p.min, maxPay: p.max })} on={preset === i} onPress={() => set({ minPay: p.min, maxPay: p.max })} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PriceInput label="Min" value={filters.minPay} onChange={(minPay) => set({ minPay })} />
          <RNText style={tx('500', 13, t.colors.muted)}>to</RNText>
          <PriceInput label="Max" value={filters.maxPay} onChange={(maxPay) => set({ maxPay })} />
        </View>
        {filters.maxPay > 0 && filters.maxPay < filters.minPay ? (
          <RNText style={tx('500', 12, t.colors.muted)}>
            Max is lower than Min, so the range is used the other way round: {priceLabel(cleanPrice(filters.minPay, filters.maxPay))}.
          </RNText>
        ) : null}
      </Group>

      <Group title="How they hire">
        <View>
          <Check label="Auto-hire" on={filters.auto} onPress={() => set({ auto: !filters.auto })} />
          <Check label="Open to counter offers" on={filters.offers} onPress={() => set({ offers: !filters.offers })} />
        </View>
      </Group>

      <Group title="When">
        <Check label="Due in 24 hours" on={filters.dueSoon} onPress={() => set({ dueSoon: !filters.dueSoon })} />
      </Group>
    </View>
  );
}
