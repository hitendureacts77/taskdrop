import React from 'react';
import { View, Text as RNText, Pressable, ScrollView, type TextStyle, type ViewStyle } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { fontFamilyFor } from '../theme';

/**
 * Withdraw — pixel parity with docs/design/_design_markup.html lines 1097-1129.
 * Sweeps the whole available balance (design's doWithdraw, _design_source.jsx
 * lines 900-905): rolls the balance to zero, celebrates, returns to the wallet.
 */

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

function Pressy({
  onPress,
  style,
  children,
}: {
  onPress?: () => void;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}

export function WithdrawScreen() {
  const t = useTheme();
  const { go, back } = useNav();
  const { balance, roll, celebrate } = useApp();

  const rows: { label: string; value: string; strong: boolean }[] = [
    { label: 'Available', value: formatINR(balance), strong: false },
    { label: 'Transfer fee', value: 'Free', strong: false },
    { label: 'You receive', value: formatINR(balance), strong: true },
  ];

  const doWithdraw = () => {
    const amount = formatINR(balance);
    roll('balance', 0);
    celebrate(`${amount} on its way`);
    go('wallet');
  };

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={back} hitSlop={10}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <RNText style={tx('700', 17, t.colors.ink)}>Withdraw</RNText>
        </View>

        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 24 })}>Amount</RNText>
        <RNText style={tx('800', 44, t.colors.ink, { letterSpacing: -1.76, lineHeight: 46.2, marginTop: 4 })}>
          {formatINR(balance)}
        </RNText>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 8 })}>
          Full available balance. Arrives in 1 working day.
        </RNText>

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 24 })}>TO</RNText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 13,
            marginTop: 11,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: t.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('800', 14, t.colors.accentDeep)}>UPI</RNText>
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 15, t.colors.ink)}>raju@okhdfcbank</RNText>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>Default payout method</RNText>
          </View>
          <RNText style={tx('600', 13, t.colors.accentDeep)}>Change</RNText>
        </View>

        <View style={{ marginTop: 18 }}>
          {rows.map((r) => (
            <View
              key={r.label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 13,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
              }}
            >
              <RNText style={tx('400', 14, r.strong ? t.colors.ink : t.colors.muted)}>{r.label}</RNText>
              <RNText style={tx(r.strong ? '800' : '600', 14, t.colors.ink)}>{r.value}</RNText>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressy
          onPress={doWithdraw}
          style={{
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>Withdraw {formatINR(balance)}</RNText>
        </Pressy>
      </View>
    </Screen>
  );
}
