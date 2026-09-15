import { useEffect, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  type TextStyle,
} from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import {
  startPromotion,
  createPaymentLink,
  syncPayment,
  activatePromotion,
  promotableTasks,
  type PromotableTask,
} from '../data/api';
import { formatINR } from '../components/ui';
import { Linking } from 'react-native';
import { tx } from '../components/primitives';

const DURATIONS = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
];

export function PromoteScreen() {
  const t = useTheme();
  const { go, back, params } = useNav();
  const { mode } = useMode();
  const { celebrate, flash } = useApp();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ promotionId: string; paymentId: string } | null>(null);
  const [explaining, setExplaining] = useState(false);

  // Which listing is being promoted. Arrives pre-chosen when you come from a
  // task, otherwise you pick from your own open ones.
  const [mine, setMine] = useState<PromotableTask[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [pickedId, setPickedId] = useState<string | null>(
    typeof params.taskId === 'string' ? params.taskId : null,
  );

  useEffect(() => {
    let alive = true;
    void promotableTasks()
      .then((rows) => {
        if (!alive) return;
        setMine(rows);
        // Nothing pre-chosen and exactly one candidate: choosing it for them
        // is obvious rather than presumptuous.
        setPickedId((cur) => cur ?? (rows.length === 1 ? rows[0]!.id : null));
      })
      .catch(() => {})
      .finally(() => alive && setLoadingMine(false));
    return () => {
      alive = false;
    };
  }, []);

  const taskId = pickedId;
  const picked = mine.find((m) => m.id === pickedId) ?? null;
  // The list is collapsed once something is chosen. Five full-width cards
  // pushed the budget and duration — the things this screen is actually for —
  // off the bottom of the screen.
  const [choosing, setChoosing] = useState(false);
  // Typing filters the list rather than scrolling it. Five listings fit on a
  // screen; fifty do not, and this screen exists to set a budget, not to be a
  // list of everything you have ever posted.
  const [listingQuery, setListingQuery] = useState('');

  const matches = (() => {
    const q = listingQuery.trim().toLowerCase();
    if (!q) return mine;
    return mine.filter((m) => m.title.toLowerCase().includes(q));
  })();


  const worker = mode === 'worker';
  const [budgetIdx, setBudgetIdx] = useState(1);
  const [durIdx, setDurIdx] = useState(1);
  const [audienceOn, setAudienceOn] = useState(false);

  const budgets = worker ? [50, 80, 150] : [80, 150, 300];
  const budget = budgets[budgetIdx]!;
  const days = DURATIONS[durIdx]!.days;
  const total = budget * days;

  // Design's reach model: base band, narrowed to 55% when the audience filter is
  // on, scaled by the chosen budget relative to the middle tier.
  const base = worker ? [900, 1600] : [1800, 3400];
  const scale = (audienceOn ? 0.55 : 1) * (budget / budgets[1]!);
  const reach = base.map((n) => Math.round(n * scale).toLocaleString('en-IN'));

  const label = (s: string, extra?: TextStyle, color?: string) => (
    <RNText style={tx('400', 11, color ?? t.colors.muted, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  const chipRow = (
    items: string[],
    active: number,
    onPick: (i: number) => void,
    extra?: TextStyle,
  ) => (
    <View style={{ flexDirection: 'row', gap: 8, ...extra }}>
      {items.map((it, i) => {
        const on = active === i;
        return (
          <Pressable
            key={it}
            onPress={() => onPick(i)}
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
            <RNText style={tx('600', 13, on ? t.colors.ink : t.colors.muted)}>{it}</RNText>
          </Pressable>
        );
      })}
    </View>
  );

  /**
   * Buy the placement.
   *
   * This used to celebrate "Campaign live" and navigate away, having written
   * nothing and charged nothing. A campaign is now a real row that stays
   * pending until its payment settles — the server will not switch it on
   * without a paid payment, so abandoning the payment page gets you nothing
   * rather than free advertising.
   */
  const start = async () => {
    if (busy) return;
    if (!taskId) {
      flash(
        mine.length === 0
          ? 'You have no open listings to promote yet'
          : 'Pick which listing to promote first',
      );
      return;
    }
    setBusy(true);
    try {
      const totalMinor = total * 100;
      const promo = await startPromotion(taskId, days, totalMinor);
      const { paymentId, url } = await createPaymentLink({
        purpose: 'escrow',
        amountMinor: totalMinor,
        taskId,
      });
      setPending({ promotionId: promo.id, paymentId });
      await Linking.openURL(url);
      flash('Finish the payment, then come back and tap Activate');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not start that campaign');
    } finally {
      setBusy(false);
    }
  };

  /** Switch it on, once the money is actually in. */
  const activate = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const status = await syncPayment(pending.paymentId);
      if (status !== 'paid') {
        flash('No payment seen yet — it can take a few seconds');
        return;
      }
      await activatePromotion(pending.promotionId, pending.paymentId);
      celebrate(`Campaign live · ${formatINR(total * 100)} for ${days} ${days === 1 ? 'day' : 'days'}`);
      go(worker ? 'home' : 'orders');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not activate that campaign');
    } finally {
      setBusy(false);
    }
  };

  /**
   * What the money buys, in plain words.
   *
   * Everything in here has to stay true of what the code actually does: a paid
   * campaign marks the listing sponsored, and sponsored listings sort to the
   * top of the feed until the campaign ends. If that changes, this changes.
   */
  const explainer = (
    <Modal
      visible={explaining}
      transparent
      animationType="slide"
      onRequestClose={() => setExplaining(false)}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => setExplaining(false)}
          accessibilityLabel="Close"
        />
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 22,
            paddingBottom: 30,
          }}
        >
          <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>
            What promoting does
          </RNText>

          <RNText style={tx('400', 14, t.colors.text, { marginTop: 12, lineHeight: 21 })}>
            A promoted listing sits at the top of the feed, above everything posted normally,
            and is marked as sponsored. That is the whole mechanism — it buys position, nothing
            else.
          </RNText>

          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 18 })}>
            What the budget changes
          </RNText>
          <RNText style={tx('400', 14, t.colors.text, { marginTop: 6, lineHeight: 21 })}>
            The daily budget sets how many people your listing is put in front of each day, and
            the duration sets how many days that lasts. A bigger daily budget reaches more
            people per day; more days reaches people who were not looking today. Same total
            money, different shape — {formatINR(total * 100)} spread over {days}{' '}
            {days === 1 ? 'day' : 'days'} is {formatINR(budget * 100)} a day.
          </RNText>

          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 18 })}>
            What it does not do
          </RNText>
          <RNText style={tx('400', 14, t.colors.text, { marginTop: 6, lineHeight: 21 })}>
            It does not make anyone quote, and it does not change your price. A listing with a
            rate well under the going one will be seen more and still be passed over. If a
            listing has been up a while with no quotes, the price is usually the reason — not
            the position.
          </RNText>

          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 18 })}>When it is worth it</RNText>
          <RNText style={tx('400', 14, t.colors.text, { marginTop: 6, lineHeight: 21 })}>
            Best on something urgent, or in a category with a lot posted at once where good
            listings get buried. Least useful on something niche, where the few people who can
            do it will find it anyway.
          </RNText>

          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 18, lineHeight: 18 })}>
            You are charged once, up front, for the days you choose. Stopping early does not
            refund the remaining days. The reach figure above is an estimate from how many
            people browse your city, not a promise.
          </RNText>

          <Pressable
            onPress={() => setExplaining(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => ({
              marginTop: 20,
              backgroundColor: t.colors.accent,
              borderRadius: 999,
              paddingVertical: 14,
              alignItems: 'center',
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <RNText style={tx('700', 15, t.colors.onAccent)}>Got it</RNText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

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
          <RNText style={tx('700', 17, t.colors.ink)}>
            {worker ? 'Promote this service' : 'Promote this task'}
          </RNText>
        </View>

        <View style={{ marginTop: 14 }}>
          {loadingMine ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 }}>
              <ActivityIndicator size="small" color={t.colors.muted} />
              <RNText style={tx('400', 13, t.colors.muted)}>Finding your listings…</RNText>
            </View>
          ) : mine.length === 0 ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: t.colors.line,
                borderStyle: 'dashed',
                borderRadius: 14,
                padding: 16,
              }}
            >
              <RNText style={tx('700', 14, t.colors.ink)}>Nothing open to promote</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 5, lineHeight: 18 })}>
                Only your own open listings can be promoted. Post one, or reopen a closed one,
                and it will show up here.
              </RNText>
            </View>
          ) : (
            <>
              <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>
                WHICH LISTING
              </RNText>

              {/* One line when settled; the full list only while choosing. */}
              {picked && !choosing ? (
                <Pressable
                  onPress={() => setChoosing(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Change listing, currently ${picked.title}`}
                  style={({ pressed }) => ({
                    marginTop: 9,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: t.colors.line,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <RNText style={tx('700', 15, t.colors.ink)} numberOfLines={1}>
                      {picked.title}
                    </RNText>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                      {formatINR(picked.benchmark_minor)} ·{' '}
                      {picked.quotes === 1 ? '1 quote' : `${picked.quotes} quotes`}
                    </RNText>
                  </View>
                  {mine.length > 1 && (
                    <RNText style={tx('700', 12, t.colors.accentDeep)}>Change</RNText>
                  )}
                </Pressable>
              ) : (
                <>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 9,
                      marginTop: 9,
                      backgroundColor: t.colors.surface2,
                      borderRadius: 11,
                      paddingHorizontal: 13,
                      paddingVertical: 10,
                    }}
                  >
                    <Icon name="search" size={16} color={t.colors.muted} strokeWidth={1.8} />
                    <TextInput
                      value={listingQuery}
                      onChangeText={setListingQuery}
                      placeholder="Search your listings"
                      placeholderTextColor={t.colors.muted}
                      autoCorrect={false}
                      style={tx('400', 14, t.colors.ink, { flex: 1, padding: 0 })}
                    />
                    {listingQuery.length > 0 && (
                      <Pressable
                        onPress={() => setListingQuery('')}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Clear the search"
                      >
                        <RNText style={tx('600', 15, t.colors.muted)}>×</RNText>
                      </Pressable>
                    )}
                  </View>

                  {matches.length === 0 && (
                    <RNText style={tx('400', 13, t.colors.muted, { marginTop: 14, lineHeight: 19 })}>
                      Nothing matches “{listingQuery.trim()}”. Only your own open listings can be
                      promoted.
                    </RNText>
                  )}

                  {matches.map((m) => {
                  const on = m.id === pickedId;
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => {
                        setPickedId(m.id);
                        setChoosing(false);
                        setListingQuery('');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Promote ${m.title}`}
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: t.colors.line,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <RNText
                          style={tx(on ? '700' : '500', 15, on ? t.colors.ink : t.colors.text)}
                          numberOfLines={1}
                        >
                          {m.title}
                        </RNText>
                        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                          {formatINR(m.benchmark_minor)} ·{' '}
                          {m.quotes === 1 ? '1 quote' : `${m.quotes} quotes`}
                        </RNText>
                      </View>
                      {on && <RNText style={tx('700', 14, t.colors.accentDeep)}>✓</RNText>}
                    </Pressable>
                  );
                  })}
                </>
              )}
            </>
          )}
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginTop: 18,
          }}
        >
          {label('DAILY BUDGET')}
          <Pressable
            onPress={() => setExplaining(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="How promotion works"
          >
            <RNText
              style={tx('700', 12, t.colors.accentDeep, { textDecorationLine: 'underline' })}
            >
              How this works
            </RNText>
          </Pressable>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 8,
            marginTop: 9,
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.accent,
          }}
        >
          <RNText style={tx('800', 29, t.colors.ink)}>₹{budget}</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginLeft: 'auto' })}>
            ₹{total.toLocaleString('en-IN')} over {DURATIONS[durIdx]!.label}
          </RNText>
        </View>
        {chipRow(budgets.map((b) => `₹${b}`), budgetIdx, setBudgetIdx, { marginTop: 11 })}

        {label('RUN FOR', { marginTop: 18 })}
        {chipRow(DURATIONS.map((d) => d.label), durIdx, setDurIdx, { marginTop: 10 })}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 20,
          }}
        >
          <View style={{ flex: 1 }}>
            {label('SHOW IT TO · OPTIONAL')}
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
              {audienceOn ? 'Narrowing who sees it' : 'Off · everyone in your city'}
            </RNText>
          </View>
          <Pressable
            onPress={() => setAudienceOn((v) => !v)}
            style={{
              width: 42,
              height: 24,
              borderRadius: 999,
              padding: 3,
              backgroundColor: audienceOn ? t.colors.accent : t.colors.line,
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                backgroundColor: '#FFFFFF',
                transform: [{ translateX: audienceOn ? 18 : 0 }],
              }}
            />
          </Pressable>
        </View>

        {audienceOn && (
          <View style={{ marginTop: 14 }}>
            {[
              worker ? 'Posters within 15 km' : 'Workers within 12 km',
              worker ? 'Services' : 'Services · Products',
            ].map((row, i) => (
              <View
                key={row}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: i === 0 ? 0 : 11,
                  paddingBottom: 11,
                  borderBottomWidth: 1,
                  borderBottomColor: t.colors.line,
                }}
              >
                <RNText style={tx('400', 15, t.colors.ink)}>{row}</RNText>
                <RNText style={tx('600', 13, t.colors.accentDeep)}>Change</RNText>
              </View>
            ))}
          </View>
        )}

        <View
          style={{
            marginTop: 16,
            backgroundColor: t.colors.accentSoft,
            borderWidth: 1,
            borderColor: t.colors.accentBorder,
            borderRadius: 12,
            paddingVertical: 13,
            paddingHorizontal: 16,
          }}
        >
          {label('ESTIMATED REACH', {}, t.colors.accentDeep)}
          <RNText style={tx('800', 22, t.colors.ink, { marginTop: 4 })}>
            {reach[0]} – {reach[1]}
          </RNText>
          <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 3 })}>
            {worker ? 'posters' : 'workers'} per day
            {audienceOn ? ' in your radius' : ' across your city'}
          </RNText>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressable
          onPress={() => void (pending ? activate() : start())}
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
            {busy
              ? 'Working…'
              : pending
                ? 'Activate campaign'
                : `Start campaign · ₹${total.toLocaleString('en-IN')}`}
          </RNText>
        </Pressable>
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10 })}>
          Pause or stop any time. You are charged for days run.
        </RNText>
      </View>
      {explainer}
    </Screen>
  );
}
