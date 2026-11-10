import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { View, Text as RNText, Pressable, Animated, ScrollView, type TextStyle } from 'react-native';
import { formatINR } from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { isNeedsAccount, needAccount } from '../lib/guest';
import { placeBid } from '../data/api';
import { tx } from '../components/primitives';
import { TaskDescription } from '../components/TaskDescription';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { isDuplicateOfferError } from '../lib/offerState';
import { noteMyOffer } from '../lib/useMyOffers';

const STEP = 5000; // ₹50 in paise

type SheetRow = {
  id?: string;
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
  const { celebrate, flash } = useActions();
  const { userId, guest } = useAuth();
  const [busy, setBusy] = useState(false);

  const worker = mode === 'worker';
  const row = (params.row ?? {}) as SheetRow;

  const who = row.who ?? (worker ? 'Customer 9014' : 'Worker 3315');
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

  const cta = worker ? 'Send offer' : `Send ${who} a task`;

  // Only a real task has a uuid; the design sample rows do not.
  const realId = row.id && /^[0-9a-f-]{36}$/i.test(row.id) ? row.id : null;

  const send = async () => {
    if (busy) return;

    if (worker) {
      // This used to celebrate "Quote sent" and navigate home without writing
      // anything. The worker believed they had quoted and the poster never saw
      // a thing -- the worst possible failure for a marketplace, because it is
      // silent on both sides.
      if (!realId) return flash('This is a sample card — open a real task to send an offer');
      if (guest) return needAccount('offer', () => void send());
      if (!userId) return flash('Sign in to send an offer');
      setBusy(true);
      try {
        await placeBid({
          taskId: realId,
          workerId: userId,
          priceMinor: quote,
          timeLimitMinutes: 240,
        });
        noteMyOffer(userId, realId);
        celebrate(`Offer sent · ${formatINR(quote)}`);
        go('orders');
      } catch (e) {
        if (isNeedsAccount(e)) return;
        if (isDuplicateOfferError(e)) {
          // One offer per task: open the task, where the sent offer can be edited.
          flash('You already sent an offer for this task. Opening it so you can edit it.');
          go('taskDetail', { row });
          return;
        }
        flash(e instanceof Error ? e.message : 'Could not send the offer');
      } finally {
        setBusy(false);
      }
      return;
    }

    // Reverse direction: a customer asks this worker to do a task of their own; a listing cannot be paid
    // for directly, so this starts a new request.
    go('aiPost', { prompt: `${title}: ` });
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
              <Icon name="user" size={18} color={t.colors.muted} />
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
          <View style={{ marginTop: 12 }}>
            <TaskDescription text={body} title={title} />
          </View>

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
              {label(worker ? 'THEIR OFFER' : 'THEIR RATE')}
              <RNText style={tx('800', 20, t.colors.accentDeep, { marginTop: 4 })}>
                {formatINR(asked)}
              </RNText>
            </View>
            <View style={{ flex: 1, paddingVertical: 14 }}>
              {label('RATING')}
              <RNText style={tx('700', 20, t.colors.gold, { marginTop: 4 })}>★ {rating}</RNText>
            </View>
          </View>

          {worker ? label('YOUR OFFER', { marginTop: 20 }) : null}
          {worker ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 }}>
            <StepBtn sign="−" onPress={() => setQuote((q) => Math.max(STEP, q - STEP))} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <AmountField
                rupees={Math.round(quote / 100)}
                onChangeRupees={(r) => setQuote((r ?? 0) * 100)}
                min={1}
                style={tx('800', 30, t.colors.ink, { letterSpacing: -0.9 })}
              />
              <RNText style={tx('400', 11, deltaInk, { marginTop: 2 })}>{deltaText}</RNText>
            </View>
            <StepBtn sign="+" onPress={() => setQuote((q) => q + STEP)} />
          </View>
          ) : null}

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
              ? 'One offer per task. You can edit it later. Phone numbers stay hidden until the work starts.'
              : 'Post your task and this worker gets the first 10 minutes to send an offer. You can send them more than one task.'}
          </RNText>
        </ScrollView>

        <KeyboardSafe style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
          <Pressable
            onPress={() => void send()}
            style={({ pressed }) => ({
              backgroundColor: t.colors.accent,
              borderRadius: 999,
              paddingVertical: 16,
              alignItems: 'center',
              transform: [{ scale: pressed ? 0.96 : 1 }],
              shadowColor: t.colors.accent,
              shadowOpacity: 0.35,
              shadowRadius: 22,
              shadowOffset: { width: 0, height: 8 },
              elevation: 6,
            })}
          >
            <RNText style={tx('700', 16, t.colors.onAccent)}>{cta}</RNText>
          </Pressable>
        </KeyboardSafe>
      </Animated.View>
    </View>
  );
}
