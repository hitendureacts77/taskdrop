import React, { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, ScrollView, type TextStyle } from 'react-native';
import { formatINR } from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { fontFamilyFor } from '../theme';

/**
 * Quote bottom-sheet — pixel parity with docs/design/_design_markup.html lines
 * 337-394. Scrim + slide-up sheet with the ± quote stepper, the delta against
 * what was asked, and the poster's required completion date chips
 * (_design_source.jsx lines 399-454).
 */

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

const BY_CHIPS = ['Today, 8:00 PM', 'Tomorrow, 11:00 AM', '12 Sep, 2:00 PM'];
const STEP = 5000; // ₹50 in paise

type SheetRow = {
  who?: string;
  rating?: string;
  whoMeta?: string;
  title?: string;
  body?: string;
  amountMinor?: number;
  by?: string | null;
};

export function DetailSheetScreen() {
  const t = useTheme();
  const { params, go, back } = useNav();
  const { mode } = useMode();
  const { celebrate, flash } = useApp();

  const worker = mode === 'worker';
  const row = (params.row ?? {}) as SheetRow;

  const who = row.who ?? (worker ? 'Poster 9014' : 'Tasker 3315');
  const rating = row.rating ?? (worker ? '4.8' : '4.9');
  const whoMeta = row.whoMeta ?? (worker ? '31 requests posted · 3.2 km away' : '61 jobs done · 4 km away');
  const title = row.title ?? (worker ? 'Vintage 35mm film camera' : 'Bespoke carpentry and joinery');
  const body =
    row.body ??
    (worker
      ? 'Working SLR, clean viewfinder, tested shutter. Pentax or Olympus preferred, lens included.'
      : 'Ten years of joinery. Wardrobes, shelving, alcove units, on-site fitting included.');
  const asked = row.amountMinor ?? (worker ? 450000 : 120000);

  const [quote, setQuote] = useState(asked);
  const [by, setBy] = useState<string | null>(null);

  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(rise, { toValue: 1, duration: 340, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [rise]);

  const delta = quote - asked;
  const deltaText =
    delta === 0 ? 'same as asked' : delta > 0 ? `+${formatINR(delta)} above` : `−${formatINR(-delta)} below`;
  const deltaInk = delta === 0 ? t.colors.muted : delta > 0 ? t.colors.gold : t.colors.accentDeep;

  const blocked = !worker && !by;
  const cta = worker
    ? 'Send quote'
    : blocked
      ? 'Set a completion date and time'
      : quote === asked
        ? 'Accept and fund escrow'
        : 'Send counter and fund escrow';

  const send = () => {
    if (worker) {
      celebrate(`Quote sent · ${formatINR(quote)}`);
      go('home');
      return;
    }
    if (blocked) return flash('Set a completion date and time first');
    go('escrow', { title, priceMinor: quote, who, by });
  };

  const label = (s: string, extra?: TextStyle) => (
    <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  const StepBtn = ({ sign, onPress }: { sign: string; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: t.colors.line,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <RNText style={tx('400', 20, t.colors.ink)}>{sign}</RNText>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={back} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} />

      <Animated.View
        style={{
          marginTop: 'auto',
          maxHeight: '88%',
          backgroundColor: t.colors.bg,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
        }}
      >
        <View style={{ paddingTop: 12, alignItems: 'center' }}>
          <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: t.colors.line }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                backgroundColor: t.colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx('400', 16, t.colors.muted)}>☺</RNText>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <RNText style={tx('700', 15, t.colors.ink)}>{who}</RNText>
                <RNText style={tx('400', 12, t.colors.muted)}>★ {rating}</RNText>
              </View>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>{whoMeta}</RNText>
            </View>
          </View>

          <RNText style={tx('800', 23, t.colors.ink, { letterSpacing: -0.69, marginTop: 16 })}>
            {title}
          </RNText>
          <RNText style={tx('400', 14, t.colors.text, { lineHeight: 21.7, marginTop: 10 })}>{body}</RNText>

          <View
            style={{
              flexDirection: 'row',
              marginTop: 18,
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: t.colors.line,
            }}
          >
            <View style={{ flex: 1, paddingVertical: 14 }}>
              {label(worker ? 'THEIR QUOTE' : 'THEIR RATE')}
              <RNText style={tx('800', 20, t.colors.accentDeep, { marginTop: 4 })}>
                {formatINR(asked)}
              </RNText>
            </View>
            <View style={{ flex: 1, paddingVertical: 14 }}>
              {label('RATING')}
              <RNText style={tx('700', 20, t.colors.gold, { marginTop: 4 })}>★ {rating}</RNText>
            </View>
          </View>

          {label('YOUR QUOTE', { marginTop: 20 })}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 }}>
            <StepBtn sign="−" onPress={() => setQuote((q) => Math.max(STEP, q - STEP))} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <AmountField
                rupees={Math.round(quote / 100)}
                onChangeRupees={(r) => setQuote(r * 100)}
                min={1}
                style={tx('800', 30, t.colors.ink, { letterSpacing: -0.9 })}
              />
              <RNText style={tx('400', 11, deltaInk, { marginTop: 2 })}>{deltaText}</RNText>
            </View>
            <StepBtn sign="+" onPress={() => setQuote((q) => q + STEP)} />
          </View>

          {!worker && (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginTop: 22,
                }}
              >
                {label('COMPLETE BY · REQUIRED')}
                <RNText style={tx('600', 13, by ? t.colors.ink : t.colors.signal)}>
                  {by ?? 'Pick a date and time'}
                </RNText>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
                {BY_CHIPS.map((c) => {
                  const on = by === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setBy(c)}
                      style={({ pressed }) => ({
                        flex: 1,
                        borderRadius: 10,
                        paddingVertical: 11,
                        alignItems: 'center',
                        backgroundColor: on ? t.colors.accentSoft : 'transparent',
                        borderWidth: 1,
                        borderColor: on ? t.colors.accent : t.colors.line,
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                      })}
                    >
                      <RNText style={tx('600', 12, on ? t.colors.ink : t.colors.muted)}>{c}</RNText>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {worker && (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 20,
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
              }}
            >
              <RNText style={tx('400', 14, t.colors.ink)}>Complete by</RNText>
              <RNText style={tx('600', 14, t.colors.muted)}>{row.by ?? '9 Sep, 6 PM'}</RNText>
            </View>
          )}

          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 12, lineHeight: 18 })}>
            {worker
              ? 'One quote per task. Contacts stay masked until the task starts.'
              : 'Your quote goes to this worker. They can lock it and start.'}
          </RNText>
        </ScrollView>

        <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
          <Pressable
            onPress={send}
            style={({ pressed }) => ({
              backgroundColor: blocked ? t.colors.surface2 : t.colors.accent,
              borderRadius: 999,
              paddingVertical: 16,
              alignItems: 'center',
              transform: [{ scale: pressed ? 0.96 : 1 }],
              ...(blocked
                ? {}
                : {
                    shadowColor: t.colors.accent,
                    shadowOpacity: 0.35,
                    shadowRadius: 22,
                    shadowOffset: { width: 0, height: 8 },
                    elevation: 6,
                  }),
            })}
          >
            <RNText style={tx('700', 16, blocked ? t.colors.muted : t.colors.onAccent)}>{cta}</RNText>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
