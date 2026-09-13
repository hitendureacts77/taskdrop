import { useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Screen, Text, Row, Button, Avatar, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';

type Quote = {
  who: string;
  rating: number;
  meta: string;
  priceMinor: number;
  task: string;
};

// _design_source.jsx lines 246-250
const MY_QUOTE_DATA: Quote[] = [
  { who: 'Poster 6620', rating: 4.8, meta: '14 requests posted · 1.1 km away', priceMinor: 140000, task: 'Build a fitted alcove shelf, three tiers' },
  { who: 'Poster 9014', rating: 4.8, meta: '31 requests posted · 3.2 km away', priceMinor: 115000, task: 'Repair two wardrobe doors and realign hinges' },
  { who: 'Poster 4471', rating: 4.6, meta: '7 requests posted · 2.4 km away', priceMinor: 98000, task: 'Cut and fit a desk top to a bay window' },
];

/** Worker flow: quotes posters have sent on the worker's own service listing.
 * _design_source.jsx lines 749-767, markup at TaskDrop App.dc.html lines 847-882. */
export function MyQuotesScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { celebrate } = useApp();
  const [picked, setPicked] = useState(0);

  const current = MY_QUOTE_DATA[picked] ?? MY_QUOTE_DATA[0]!;

  const handleLock = () => {
    celebrate('Quote locked · escrow funded');
    go('swipe', { title: current.task, priceMinor: current.priceMinor });
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <Pressable onPress={back} hitSlop={10} style={{ paddingTop: 8 }}>
          <Text variant="h2" color="muted">
            ←
          </Text>
        </Pressable>

        <Text variant="h1" style={{ marginTop: 16 }}>
          Quotes on my service
        </Text>
        <Text color="muted" variant="body" style={{ marginTop: 8, lineHeight: 21, marginBottom: 4 }}>
          Posters sent these to your carpentry listing. Lock one to take the job.
        </Text>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
          {MY_QUOTE_DATA.map((row, i) => {
            const selected = i === picked;
            return (
              <Pressable
                key={row.who}
                onPress={() => setPicked(i)}
                style={{
                  backgroundColor: selected ? t.colors.accentSoft : t.colors.surface,
                  borderWidth: 1,
                  borderColor: selected ? t.colors.accent : t.colors.line,
                  borderRadius: t.radius.lg,
                  padding: 14,
                  marginTop: 12,
                }}
              >
                <Row gap={11} align="center">
                  <Avatar name={row.who} size={36} />
                  <View style={{ flex: 1 }}>
                    <Row gap={7} align="center">
                      <Text variant="h3">{row.who}</Text>
                      <Text color="muted" variant="caption">
                        ★ {row.rating.toFixed(1)}
                      </Text>
                    </Row>
                    <Text color="muted" variant="caption" style={{ marginTop: 3 }}>
                      {row.meta}
                    </Text>
                  </View>
                  <Text variant="h3">{formatINR(row.priceMinor)}</Text>
                </Row>
                <Text variant="body" style={{ color: t.colors.text, marginTop: 11, lineHeight: 20 }}>
                  {row.task}
                </Text>
                {selected && (
                  <Row
                    gap={7}
                    align="center"
                    style={{
                      marginTop: 11,
                      paddingTop: 11,
                      borderTopWidth: 1,
                      borderTopColor: t.colors.accentBorder,
                    }}
                  >
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.colors.accent }} />
                    <Text variant="label" style={{ color: t.colors.accentDeep, letterSpacing: 1 }}>
                      SELECTED
                    </Text>
                  </Row>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ paddingTop: 14, paddingBottom: 24 }}>
        <Button label={`Lock quote · ${formatINR(current.priceMinor)}`} onPress={handleLock} />
        <Text color="muted" variant="caption" style={{ textAlign: 'center', marginTop: 10, lineHeight: 18 }}>
          Locking funds escrow, then you swipe to start.
        </Text>
      </View>
    </Screen>
  );
}
