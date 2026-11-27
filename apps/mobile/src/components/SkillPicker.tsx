import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, TextInput, ScrollView, Platform } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { BottomSheet, PrimaryButton } from './kit';
import { Icon } from './Icon';
import { tx } from './primitives';
import { addCatalogTerm, checkCatalogTerm, listCatalog, type CatalogKind, type CheckResult } from '../data/catalog';
import { canonicalLabel, hasExact, isPicked, pickView, profileView, searchItems, showAllLabel, tidy, type CatalogItem } from '../lib/catalogPick';

/**
 * One picker for the shared, ranked skill and category lists (task 1.19 row E).
 * Skills are multi-pick (max 8), categories are single-pick (max 1). Colours come from the theme,
 * so Earn screens are royal blue and Hire screens jade by themselves, light and dark.
 */

const WORDS = {
  skill: { one: 'skill', many: 'skills', who: 'workers', usesLine: (n: number) => `picked by ${n} ${n === 1 ? 'worker' : 'workers'}` },
  category: { one: 'category', many: 'categories', who: 'posters', usesLine: (n: number) => `used by ${n} ${n === 1 ? 'task' : 'tasks'}` },
} as const;

/** Loads the ranked list (built-in fallback is inside listCatalog). */
export function useCatalog(kind: CatalogKind): CatalogItem[] {
  const [items, setItems] = useState<CatalogItem[]>([]);
  useEffect(() => {
    let live = true;
    void listCatalog(kind).then((r) => live && setItems(r));
    return () => {
      live = false;
    };
  }, [kind]);
  return items;
}

function TermPill({ label, on, fresh, onPress }: { label: string; on: boolean; fresh?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
        borderWidth: 1.5,
        borderColor: on ? t.colors.accent : t.colors.line,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 13,
        transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
      })}
    >
      {on ? <Icon name="check" size={14} color={t.colors.accentDeep} strokeWidth={2.6} /> : null}
      <RNText style={tx(on ? '700' : '600', 13, on ? t.colors.accentDeep : t.colors.text)} numberOfLines={1}>
        {label}
      </RNText>
      {fresh ? (
        <View style={{ backgroundColor: t.colors.goldSoft, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}>
          <RNText style={tx('800', 9, t.colors.goldInk, { letterSpacing: 0.6 })}>NEW</RNText>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The "add your own" card: checks what was typed, then asks to pick the existing term, refuses, or adds a new one.
 * Also used inside the post form's category search sheet.
 */
export function AddTermCard({
  kind,
  initialText = '',
  onPick,
  onClose,
}: {
  kind: CatalogKind;
  initialText?: string;
  /** Called with the label to select; `fresh` is true for a term added just now. */
  onPick: (label: string, fresh: boolean) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const w = WORDS[kind];
  const [text, setText] = useState(initialText);
  const [res, setRes] = useState<CheckResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    const n = ++run.current;
    setRes(null);
    setProblem(null);
    if (text.trim().length < 2) return;
    const timer = setTimeout(() => {
      checkCatalogTerm(kind, text.trim())
        .then((r) => {
          if (run.current !== n) return;
          setRes(r);
          if (r.result === 'exact') onPick(r.term.label, false);
        })
        .catch((e: unknown) => {
          if (run.current === n) setProblem(problemText(e, w.one));
        });
    }, 400);
    return () => clearTimeout(timer);
    // onPick is a fresh closure each render; only the text should restart the check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, kind]);

  const finish = (r: Awaited<ReturnType<typeof addCatalogTerm>>) => {
    if (r.result === 'added') {
      onPick(r.term.label, true);
      onClose();
    } else if (r.result === 'exact') {
      onPick(r.term.label, false);
      onClose();
    } else {
      setRes(r);
    }
  };
  const add = (force: boolean) => {
    setBusy(true);
    setProblem(null);
    addCatalogTerm(kind, text.trim(), force)
      .then(finish)
      .catch((e: unknown) => setProblem(problemText(e, w.one)))
      .finally(() => setBusy(false));
  };

  const box = (bg: string, border: string) => ({ marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: bg, borderWidth: 1, borderColor: border, gap: 10 });

  return (
    <View style={{ marginTop: 14, padding: 16, borderRadius: 18, borderWidth: 1.5, borderColor: t.colors.accentBorder, backgroundColor: t.colors.surface }}>
      <RNText style={tx('800', 15, t.colors.ink)}>Add your own {w.one}</RNText>
      <View
        style={{
          marginTop: 10,
          height: 48,
          paddingHorizontal: 14,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: t.colors.accent,
          backgroundColor: t.colors.surface,
          justifyContent: 'center',
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          maxLength={30}
          placeholder={kind === 'skill' ? 'e.g. Dog walking' : 'e.g. Pet care'}
          placeholderTextColor={t.colors.muted}
          accessibilityLabel={`Your ${w.one}`}
          style={tx('500', 16, t.colors.ink, { padding: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) })}
        />
      </View>
      <RNText style={tx('500', 12, t.colors.muted, { marginTop: 6, textAlign: 'right' })}>{text.length}/30</RNText>

      {problem ? (
        <View style={box(t.colors.signalSoft, t.colors.signal)}>
          <RNText style={tx('600', 13.5, t.colors.signalDeep)}>{problem}</RNText>
        </View>
      ) : null}

      {res?.result === 'refused' ? (
        <View style={box(t.colors.signalSoft, t.colors.signal)}>
          <RNText style={tx('600', 13.5, t.colors.signalDeep)}>{res.message ?? `That ${w.one} can't be used. Try other words.`}</RNText>
        </View>
      ) : null}

      {res?.result === 'exact' ? (
        <View style={box(t.colors.accentSoft, t.colors.accentBorder)}>
          <RNText style={tx('600', 13.5, t.colors.accentDeep)}>
            {res.term.label} is already a {w.one}, so we've picked it for you.
          </RNText>
        </View>
      ) : null}

      {res?.result === 'covered' ? (
        <View style={box(t.colors.surface2, t.colors.line)}>
          <RNText style={tx('600', 13.5, t.colors.text)}>This is already covered by</RNText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <TermPill label={res.term.label} on onPress={() => undefined} />
            {res.term.uses > 0 ? <RNText style={tx('500', 12.5, t.colors.muted)}>{w.usesLine(res.term.uses)}</RNText> : null}
          </View>
          <PrimaryButton
            label={`Pick ${res.term.label}`}
            onPress={() => {
              onPick(res.term.label, false);
              onClose();
            }}
          />
          {res.canForce ? (
            <Pressable onPress={() => add(true)} disabled={busy} accessibilityRole="button" hitSlop={8}>
              <RNText style={tx('600', 12.5, t.colors.muted, { textDecorationLine: 'underline', textAlign: 'center' })}>
                My {w.one} is something different
              </RNText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {res?.result === 'new' ? (
        <View style={box(t.colors.surface2, t.colors.line)}>
          <RNText style={tx('500', 13.5, t.colors.text, { lineHeight: 19 })}>
            This isn't covered by any {w.one} yet. <RNText style={tx('700', 13.5, t.colors.ink)}>{res.label}</RNText> will be added to the list so other {w.who} can pick it too.
          </RNText>
          <PrimaryButton label={`Add ${w.one}`} busy={busy} onPress={() => add(false)} />
        </View>
      ) : null}

      <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'center', marginTop: 12, padding: 4 }}>
        <RNText style={tx('700', 13.5, t.colors.muted)}>Cancel</RNText>
      </Pressable>
    </View>
  );
}

/** A plain reason for a failed check or add. An older server that has no catalog yet answers "Unknown request". */
function problemText(e: unknown, one: string): string {
  const msg = e instanceof Error ? e.message : '';
  if (!msg || /unknown request|not found|404/i.test(msg)) return `Adding your own ${one} isn't switched on yet. Pick one from the list for now.`;
  return msg;
}

/** The ranked picker. `max` 1 makes it a single pick (categories). */
export function SkillPicker({
  kind = 'skill',
  value,
  onChange,
  max = kind === 'skill' ? 8 : 1,
  variant = 'signup',
  onLimit,
}: {
  kind?: CatalogKind;
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  /** 'profile': picked ones on top, then the rest. 'signup': one ranked list with picks highlighted in place. */
  variant?: 'signup' | 'profile';
  /** Called when a pick is refused because the limit is reached (a screen may flash its own toast). */
  onLimit?: () => void;
}) {
  const t = useTheme();
  const w = WORDS[kind];
  const items = useCatalog(kind);
  const [fresh, setFresh] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [seed, setSeed] = useState('');
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const [limitNote, setLimitNote] = useState(false);

  const toggle = (label: string) => {
    if (isPicked(value, label)) {
      onChange(value.filter((s) => s.trim().toLowerCase() !== label.trim().toLowerCase()));
      setLimitNote(false);
    } else if (max === 1) {
      onChange([label]);
    } else if (value.length >= max) {
      setLimitNote(true);
      onLimit?.();
    } else {
      onChange([...value, label]);
    }
  };
  const pickNew = (label: string, isNew: boolean) => {
    const clean = canonicalLabel(items, label);
    if (isNew) setFresh((f) => [...f, clean.toLowerCase()]);
    if (!isPicked(value, clean)) {
      if (max === 1) onChange([clean]);
      else if (value.length < max) onChange([...value, clean]);
      else {
        setLimitNote(true);
        onLimit?.();
      }
    }
  };

  const isFresh = (label: string) => fresh.includes(label.trim().toLowerCase());
  const pill = (it: CatalogItem) => <TermPill key={it.id} label={it.label} on={isPicked(value, it.label)} fresh={isFresh(it.label)} onPress={() => toggle(it.label)} />;
  const wrap = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const;
  const view = pickView(items, value);

  const closeAll = () => {
    setAll(false);
    setQ('');
  };
  const needle = q.trim();
  const found = searchItems(items, q);
  const canAddTyped = needle.length >= 2 && !hasExact(items, needle);

  const heading = (text: string) => <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 16, marginBottom: 10 })}>{text}</RNText>;

  let body;
  if (variant === 'profile') {
    const pv = profileView(items, value);
    const rest = pv.rest.slice(0, view.hasMore ? 12 : pv.rest.length);
    body = (
      <>
        {max > 1 ? heading(`${kind === 'skill' ? 'SKILLS' : 'PICKED'} · ${value.length} OF ${max}`) : null}
        {pv.picked.length ? <View style={wrap}>{pv.picked.map(pill)}</View> : null}
        {heading('ADD MORE')}
        <View style={wrap}>{rest.map(pill)}</View>
      </>
    );
  } else {
    body = <View style={wrap}>{view.shown.map(pill)}</View>;
  }

  return (
    <View>
      {body}
      {limitNote ? <RNText style={tx('600', 13, t.colors.signalDeep, { marginTop: 10 })}>You can pick up to {max} {w.many}. Tap one to remove it first.</RNText> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 14 }}>
        {view.hasMore ? (
          <Pressable onPress={() => setAll(true)} accessibilityRole="button" hitSlop={6}>
            <RNText style={tx('700', 13.5, t.colors.accentDeep)}>{showAllLabel(view.total, kind)} ›</RNText>
          </Pressable>
        ) : null}
        {!adding ? (
          <Pressable
            onPress={() => {
              setSeed('');
              setAdding(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Add your own ${w.one}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 13,
              borderRadius: 999,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: t.colors.accentBorder,
              transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
            })}
          >
            <Icon name="plus" size={14} color={t.colors.accentDeep} strokeWidth={2.4} />
            <RNText style={tx('700', 13, t.colors.accentDeep)}>Add your own {w.one}</RNText>
          </Pressable>
        ) : null}
      </View>

      {adding ? <AddTermCard key={seed} kind={kind} initialText={seed} onPick={pickNew} onClose={() => setAdding(false)} /> : null}

      <BottomSheet
        visible={all}
        onClose={closeAll}
        title={`All ${w.many}`}
        footer={<PrimaryButton label="Done" onPress={closeAll} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5, borderColor: t.colors.accent, backgroundColor: t.colors.surface }}>
          <Icon name="search" size={18} color={t.colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={`Search ${w.many}`}
            placeholderTextColor={t.colors.muted}
            accessibilityLabel={`Search ${w.many}`}
            style={tx('500', 16, t.colors.ink, { flex: 1, padding: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) })}
          />
        </View>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 360, marginTop: 8 }} keyboardShouldPersistTaps="handled">
          {found.map((it) => {
            const on = isPicked(value, it.label);
            return (
              <Pressable
                key={it.id}
                onPress={() => {
                  toggle(it.label);
                  if (max === 1) closeAll();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 48, opacity: pressed ? 0.6 : 1 })}
              >
                <RNText style={tx(on ? '800' : '600', 16, on ? t.colors.accentDeep : t.colors.ink, { flex: 1 })}>{it.label}</RNText>
                {on ? <Icon name="check" size={18} color={t.colors.accentDeep} strokeWidth={2.6} /> : null}
              </Pressable>
            );
          })}
          {canAddTyped ? (
            <Pressable
              onPress={() => {
                setSeed(tidy(needle));
                setAdding(true);
                closeAll();
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, opacity: pressed ? 0.6 : 1 })}
            >
              <Icon name="plus" size={16} color={t.colors.accentDeep} strokeWidth={2.4} />
              <RNText style={tx('700', 15, t.colors.accentDeep, { flex: 1 })}>
                Add “{needle}” as a new {w.one}
              </RNText>
            </Pressable>
          ) : null}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
