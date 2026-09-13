import React, { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, type TextStyle } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { fontFamilyFor } from '../theme';

/**
 * Post details — pixel parity with docs/design/_design_markup.html lines
 * 622-702. Copy/handlers mirror _design_source.jsx lines 252-263 (draft copy per
 * pillar+mode) and 612-667 (media, price stepper, flags, promote reveal).
 */

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

const DRAFTS = {
  worker: [
    { title: 'Bespoke carpentry and joinery', details: 'Made-to-measure furniture, fittings and repairs. Ten years on the tools, own transport.' },
    { title: 'Vintage camera sourcing', details: 'I track down film bodies and lenses, test every shutter before handover.' },
    { title: 'On-the-ground checks', details: 'Queue checks, price scouting, site visits anywhere in central Bengaluru.' },
  ],
  poster: [
    { title: 'Assemble a wardrobe', details: 'Flat-pack unit, two doors, all parts and screws present. Tools needed.' },
    { title: 'Vintage 35mm film camera', details: 'Working SLR, clean viewfinder, tested shutter. Pentax or Olympus preferred, lens included.' },
    { title: 'Check the queue at RTO Indiranagar', details: 'Walk past and tell me how long the licence renewal line is. A photo helps.' },
  ],
} as const;

const PILLAR_LABELS = ['SERVICES', 'PRODUCTS', 'LOCAL INTEL'];
const MEDIA = [
  { glyph: '—', label: 'None' },
  { glyph: '▤', label: 'Photo' },
  { glyph: '▶', label: 'Video' },
];
const FLAGS = ['None', 'Urgent', 'Unique'];
const DURATIONS = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
];

/** Faint map grid + centre pin, standing in for the markup's CSS gradients. */
function MapBox() {
  const t = useTheme();
  const rows = [22, 44, 66, 88];
  const cols = [26, 52, 78, 104, 130, 156, 182, 208, 234, 260, 286, 312, 338, 364, 390, 416, 442];
  return (
    <View
      style={{
        marginTop: 11,
        height: 96,
        borderRadius: 12,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        overflow: 'hidden',
      }}
    >
      {rows.map((y) => (
        <View key={`r${y}`} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, backgroundColor: t.colors.line }} />
      ))}
      {cols.map((x) => (
        <View key={`c${x}`} style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: 1, backgroundColor: t.colors.line }} />
      ))}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 26, alignItems: 'center' }}>
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            borderWidth: 3,
            borderColor: t.colors.accent,
            backgroundColor: t.colors.bg,
          }}
        />
        <View style={{ width: 1.5, height: 9, backgroundColor: t.colors.accent }} />
      </View>
      <RNText style={tx('400', 11, t.colors.muted, { position: 'absolute', bottom: 8, right: 10 })}>
        Indiranagar · 5 km radius
      </RNText>
    </View>
  );
}

export function PostDetailsScreen() {
  const t = useTheme();
  const { params, go, back } = useNav();
  const { mode } = useMode();
  const { addBid, celebrate } = useApp();

  const worker = mode === 'worker';
  const pillar = typeof params.pillar === 'number' ? params.pillar : 0;
  const draft = DRAFTS[worker ? 'worker' : 'poster'][pillar] ?? DRAFTS.poster[0];

  const [price, setPrice] = useState(1200);
  const [media, setMedia] = useState(1);
  const [flag, setFlag] = useState(0);
  const [promoteOn, setPromoteOn] = useState(false);
  const [budgetIdx, setBudgetIdx] = useState(1);
  const durIdx = 1;

  const budgets = worker ? [50, 80, 150] : [80, 150, 300];
  const promoTotal = budgets[budgetIdx]! * DURATIONS[durIdx]!.days;

  const label = (s: string, extra?: TextStyle, color?: string) => (
    <RNText style={tx('400', 11, color ?? t.colors.muted, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  const publish = () => {
    addBid({
      role: mode,
      bucket: 0,
      state: worker ? 'LIVE LISTING · 0 QUOTES' : 'OPEN · 0 QUOTES',
      title: draft.title,
      price: `₹${price.toLocaleString('en-IN')}`,
      meta: 'Posted just now · Indiranagar',
      tone: 'blue',
    });
    celebrate(promoteOn ? 'Published · nudge your placement' : worker ? 'Listing published' : 'Request posted');
    go(promoteOn ? 'promote' : 'orders');
  };

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={back} hitSlop={10}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <RNText style={tx('400', 12, t.colors.muted)}>Draft saved</RNText>
        </View>

        <RNText style={tx('700', 10, t.colors.accentDeep, { letterSpacing: 1.6, marginTop: 16 })}>
          {PILLAR_LABELS[pillar]}
        </RNText>

        {label('TITLE', { marginTop: 18 })}
        <RNText
          style={tx('400', 17, t.colors.ink, {
            marginTop: 9,
            paddingBottom: 11,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          })}
        >
          {draft.title}
        </RNText>

        {label('DETAILS', { marginTop: 18 })}
        <RNText
          style={tx('400', 14, t.colors.muted, {
            marginTop: 9,
            lineHeight: 21.7,
            paddingBottom: 11,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          })}
        >
          {draft.details}
        </RNText>

        {label('PHOTOS OR VIDEO · OPTIONAL', { marginTop: 18 })}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 11 }}>
          {MEDIA.map((m, i) => {
            const on = media === i;
            return (
              <Pressable
                key={m.label}
                onPress={() => setMedia(i)}
                style={({ pressed }) => ({
                  width: 68,
                  height: 68,
                  borderRadius: 12,
                  backgroundColor: on ? t.colors.accentSoft : t.colors.surface2,
                  borderWidth: 1,
                  borderColor: on ? t.colors.accent : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                <RNText style={tx('400', 17, on ? t.colors.accentDeep : t.colors.muted)}>{m.glyph}</RNText>
                <RNText style={tx('400', 9, on ? t.colors.accentDeep : t.colors.muted)}>{m.label}</RNText>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.line,
              borderRadius: 12,
              padding: 13,
            }}
          >
            {label(worker ? 'YOUR RATE' : 'BENCHMARK', {}, t.colors.muted)}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Pressable
                onPress={() => setPrice((p) => Math.max(100, p - 100))}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RNText style={tx('400', 15, t.colors.ink)}>−</RNText>
              </Pressable>
              <RNText style={tx('800', 18, t.colors.accentDeep, { flex: 1, textAlign: 'center' })}>
                ₹{price.toLocaleString('en-IN')}
              </RNText>
              <Pressable
                onPress={() => setPrice((p) => p + 100)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RNText style={tx('400', 15, t.colors.ink)}>+</RNText>
              </Pressable>
            </View>
          </View>

          {!worker && (
            <View
              style={{
                flex: 1,
                backgroundColor: t.colors.surface,
                borderWidth: 1,
                borderColor: t.colors.accent,
                borderRadius: 12,
                padding: 13,
              }}
            >
              {label('COMPLETE BY ·', {}, t.colors.accentDeep)}
              <RNText style={tx('700', 15, t.colors.ink, { marginTop: 8 })}>9 Sep, 6:00 PM</RNText>
            </View>
          )}
        </View>

        {!worker && (
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 9 })}>
            Required · workers quote against this deadline.
          </RNText>
        )}

        {label('LOCATION', { marginTop: 18 })}
        <MapBox />

        {!worker && (
          <>
            {label('FLAG · OPTIONAL', { marginTop: 18 })}
            <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
              {FLAGS.map((f, i) => {
                const on = flag === i;
                const hue = i === 1 ? t.colors.signal : i === 2 ? t.colors.purple : t.colors.line;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFlag(i)}
                    style={({ pressed }) => ({
                      borderRadius: 999,
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderWidth: 1,
                      borderColor: on ? hue : t.colors.line,
                      backgroundColor: on ? t.colors.surface2 : 'transparent',
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <RNText
                      style={tx('600', 12, on ? (i === 0 ? t.colors.ink : hue) : t.colors.muted)}
                    >
                      {f}
                    </RNText>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            justifyContent: 'space-between',
            marginTop: 18,
            padding: 14,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            {label('PROMOTE · OPTIONAL', {}, t.colors.accentDeep)}
            <RNText style={tx('700', 15, t.colors.ink, { marginTop: 5 })}>
              {worker ? 'Promote my service' : 'Promote my task'}
            </RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3, lineHeight: 16 })}>
              {promoteOn
                ? 'Will boost right after you publish. Pause or stop any time.'
                : 'Reach more people. Pause or stop any time.'}
            </RNText>
          </View>
          <Pressable
            onPress={() => setPromoteOn((v) => !v)}
            style={{
              width: 42,
              height: 24,
              borderRadius: 999,
              padding: 3,
              backgroundColor: promoteOn ? t.colors.accent : t.colors.line,
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                backgroundColor: '#FFFFFF',
                transform: [{ translateX: promoteOn ? 18 : 0 }],
              }}
            />
          </Pressable>
        </View>

        {promoteOn && (
          <View
            style={{
              marginTop: 10,
              padding: 13,
              backgroundColor: t.colors.accentSoft,
              borderWidth: 1,
              borderColor: t.colors.accentBorder,
              borderRadius: 12,
            }}
          >
            {label('DAILY BUDGET', {}, t.colors.accentDeep)}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
              {budgets.map((b, i) => {
                const on = budgetIdx === i;
                return (
                  <Pressable
                    key={b}
                    onPress={() => setBudgetIdx(i)}
                    style={({ pressed }) => ({
                      flex: 1,
                      borderRadius: 10,
                      paddingVertical: 10,
                      alignItems: 'center',
                      backgroundColor: on ? t.colors.accentSoft : 'transparent',
                      borderWidth: 1,
                      borderColor: on ? t.colors.accent : t.colors.line,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <RNText style={tx('600', 13, on ? t.colors.ink : t.colors.muted)}>₹{b}</RNText>
                  </Pressable>
                );
              })}
            </View>
            <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 9 })}>
              Will boost right after publishing · ₹{promoTotal.toLocaleString('en-IN')} over{' '}
              {DURATIONS[durIdx]!.label}
            </RNText>
          </View>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressable
          onPress={publish}
          style={({ pressed }) => ({
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>
            {promoteOn ? 'Publish & promote' : worker ? 'Publish listing' : 'Post request'}
          </RNText>
        </Pressable>
      </View>
    </Screen>
  );
}
