import { useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { cardSurface } from '../ui';
import { Icon, type IconName } from '../Icon';
import { tx } from '../primitives';
import type { Need, NeedKind } from '../../lib/myTasksBoard';
import { ActionButton, IconTile } from './bits';
import { useLayout } from '../../lib/layout';

const ICON: Record<NeedKind, IconName> = {
  review: 'eye',
  pay: 'card',
  choose: 'users',
  repost: 'refresh',
  start: 'chevronRight',
  finish: 'send',
  offers: 'clock',
};

/**
 * "Needs you now" (D31 v11, boards MyTasks / MyWork / WebMyTasks): what is waiting on this person, built only
 * from live states (lib/myTasksBoard). Phone: a card of rows with a chevron, the whole row is the action.
 * Desktop: full width, each row with its live button on the right. Nothing waiting: nothing drawn. A long list
 * shows the most pressing few and a "Show N more" row, so the tasks below stay in reach.
 */
const FIRST = { phone: 3, desktop: 3 };

export function NeedsNow({ items, onPick, desktop, side }: { items: Need[]; onPick: (n: Need) => void; desktop: boolean; side: 'hire' | 'earn' }) {
  const t = useTheme();
  const { scale } = useLayout();
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const first = desktop ? FIRST.desktop : FIRST.phone;
  // One spare row is not worth a button: show it.
  const shown = all || items.length <= first + 1 ? items : items.slice(0, first);
  const hidden = items.length - shown.length;
  const count = (
    <View
      style={{
        minWidth: 22,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: side === 'hire' ? t.colors.signalFill : t.colors.accentSoft,
      }}
    >
      <RNText style={tx('800', 11.5, side === 'hire' ? '#FFFFFF' : t.colors.accentDeep)}>{items.length}</RNText>
    </View>
  );
  return (
    <View
      nativeID="needsNow"
      accessibilityLabel={`Needs you now, ${items.length}`}
      style={[cardSurface(t, desktop ? 16 : 20), { overflow: 'hidden', marginHorizontal: desktop ? 0 : 20, marginTop: desktop ? 0 : 14, marginBottom: desktop ? 20 : 0 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: desktop ? 20 : 16, paddingTop: 14, paddingBottom: desktop ? 12 : 4 }}>
        {desktop ? (
          <>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.signal }} />
            <RNText accessibilityRole="header" style={tx('800', 15, t.colors.ink)}>Needs you now</RNText>
          </>
        ) : (
          <RNText accessibilityRole="header" style={tx('800', 11, t.colors.accentDeep, { letterSpacing: 1.3 })}>NEEDS YOU NOW</RNText>
        )}
        {count}
      </View>
      {shown.map((n, i) => (
        <NeedRow key={n.key} need={n} first={i === 0} desktop={desktop} onPress={() => onPick(n)} />
      ))}
      {(hidden > 0 || all) && desktop ? (
        // Desktop: a pill sized to its words, centred under the rows (like Home's "Show N more"), never a full-width bar.
        <View style={{ borderTopWidth: 1, borderTopColor: t.colors.line, paddingVertical: 10, alignItems: 'center' }}>
          <Pressable
            onPress={() => setAll((v) => !v)}
            accessibilityRole="button"
            hitSlop={4}
            style={({ pressed }) => ({
              alignSelf: 'center',
              height: 32 / scale,
              justifyContent: 'center',
              paddingHorizontal: 16,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.colors.line,
              backgroundColor: t.colors.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <RNText style={tx('700', 12.5, t.colors.accentDeep)}>{all ? 'Show fewer' : `Show ${hidden} more`}</RNText>
          </Pressable>
        </View>
      ) : hidden > 0 || all ? (
        <Pressable
          onPress={() => setAll((v) => !v)}
          accessibilityRole="button"
          hitSlop={4}
          style={{ paddingHorizontal: desktop ? 20 : 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}
        >
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{all ? 'Show fewer' : `Show ${hidden} more`}</RNText>
        </Pressable>
      ) : null}
      {desktop ? null : <View style={{ height: 4 }} />}
    </View>
  );
}

function NeedRow({ need, first, desktop, onPress }: { need: Need; first: boolean; desktop: boolean; onPress: () => void }) {
  const t = useTheme();
  const { scale } = useLayout();
  const hintInk = need.tone === 'gold' ? t.colors.goldInk : need.tone === 'signal' ? t.colors.signalDeep : t.colors.muted;
  const lineText = (
    <RNText numberOfLines={1} style={tx('700', 14, t.colors.ink, { lineHeight: 20, flexShrink: 0 })}>
      {need.lead}
      {need.rest ? <RNText style={tx('400', 14, t.colors.text)}>{' · ' + need.rest}</RNText> : null}
    </RNText>
  );
  const words = (
    <View style={{ flex: 1, minWidth: 0 }}>
      <RNText numberOfLines={desktop ? 1 : 2} style={tx('700', 14, t.colors.ink, { lineHeight: 20 })}>
        {need.lead}
        {need.rest ? <RNText style={tx(desktop ? '400' : '700', 14, desktop ? t.colors.text : t.colors.ink)}>{' · ' + need.rest}</RNText> : null}
      </RNText>
      <RNText numberOfLines={1} style={tx('500', 12, hintInk, { marginTop: 2 })}>{need.hint}</RNText>
    </View>
  );
  if (desktop) {
    return (
      // One line, 52 px (design D3): icon, the bold lead and task name, then the grey note on the same line; the
      // button is 32 px, hugs its words, and only the first row's is filled.
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, height: 52 / scale, borderTopWidth: 1, borderTopColor: t.colors.line }}>
        <IconTile icon={ICON[need.kind]} tone={need.tone} size={32} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 14 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>{lineText}</View>
          <RNText numberOfLines={1} style={tx('500', 12.5, hintInk, { flex: 1, minWidth: 0 })}>{need.hint}</RNText>
        </View>
        <ActionButton row label={need.action} kind={first && need.primary ? 'primary' : 'outline'} onPress={onPress} a11y={need.rest ? `${need.action}: ${need.rest}` : need.action} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${need.lead}${need.rest ? ' · ' + need.rest : ''}. ${need.hint}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: t.colors.line }}>
        <IconTile icon={ICON[need.kind]} tone={need.tone} size={38} />
        {words}
        <Icon name="chevronRight" size={16} color={t.colors.muted} />
      </View>
    </Pressable>
  );
}
