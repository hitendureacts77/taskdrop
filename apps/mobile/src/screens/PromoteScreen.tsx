import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  type TextStyle,
} from 'react-native';
import { PROMOTE_DEFAULTS } from '@taskdrop/rules';
import { Screen } from '../components/ui';
import { BackButton, LoadFailed, PrimaryButton, TopBar, systemHeader } from '../components/kit';
import { reportError, messageOf } from '../lib/errors';
import { Icon, type IconName } from '../components/Icon';
import { useTheme, ring, PersonTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import {
  startPromotion,
  createPaymentLink,
  syncPayment,
  activatePromotion,
  promotableTasks,
  promotionQuote,
  joinPromotionLine,
  leavePromotionLine,
  type PromotableTask,
  type PromotionQuote,
} from '../data/api';
import { formatINR } from '../components/ui';
import { Linking, Platform } from 'react-native';
import { PaymentSheet } from '../components/PaymentSheet';
import { PromotionResultsCard } from '../components/PromotionResultsCard';
import { paymentReturnUrl } from '../lib/links';
import { clockText, daysLabel, promotionPriceMinor, whenText } from '../lib/promoteText';
import { tx } from '../components/primitives';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { ActionBar, FormPage, FormSection } from '../components/FormPage';
import { useLayout } from '../lib/layout';

/**
 * Promote a post. A task's poster is always in the Hire (jade) palette and a service owner in the Earn
 * (blue) one, whatever mode the app is in (PersonTheme swaps the accent tokens).
 */
export function PromoteScreen() {
  const { mode } = useMode();
  return (
    <PersonTheme role={mode === 'worker' ? 'worker' : 'poster'}>
      <PromoteBody />
    </PersonTheme>
  );
}

function PromoteBody() {
  const t = useTheme();
  const { go, back, params } = useNav();
  const { mode } = useMode();
  const { desktop } = useLayout();
  const { celebrate, flash } = useActions();
  const [busy, setBusy] = useState(false);
  // Native: the checkout opens in a sheet here rather than in Chrome.
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<{ promotionId: string; paymentId: string } | null>(null);
  const [explaining, setExplaining] = useState(false);

  // Which listing is being promoted. Arrives pre-chosen when you come from a
  // task, otherwise you pick from your own open ones.
  const [mine, setMine] = useState<PromotableTask[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [pickedId, setPickedId] = useState<string | null>(
    typeof params.taskId === 'string' ? params.taskId : null,
  );

  // A list that failed to load is not an empty list: "Nothing open to promote" would tell
  // someone with open posts that they have none.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoadingMine(true);
    setLoadFailed(false);
    void promotableTasks()
      .then((rows) => {
        if (!alive) return;
        setMine(rows);
        // Nothing pre-chosen and exactly one candidate: choosing it for them
        // is obvious rather than presumptuous.
        setPickedId((cur) => cur ?? (rows.length === 1 ? rows[0]!.id : null));
      })
      .catch((e) => {
        reportError(e, 'promote');
        if (alive) setLoadFailed(true);
      })
      .finally(() => alive && setLoadingMine(false));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const taskId = pickedId;
  const picked = mine.find((m) => m.id === pickedId) ?? null;
  // The list is collapsed once something is chosen. Five full-width cards
  // pushed the days and the button -- the things this screen is actually for --
  // off the bottom of the screen.
  const [choosing, setChoosing] = useState(false);
  // Nothing is listed until something is typed: this screen exists to promote
  // one post, not to show everything the person has ever posted. A word from
  // the title finds the post.
  const [listingQuery, setListingQuery] = useState('');

  const matches = (() => {
    const q = listingQuery.trim().toLowerCase();
    if (!q) return [];
    return mine.filter((m) => m.title.toLowerCase().includes(q));
  })();

  const worker = mode === 'worker';

  // The server's view of this post: flat day price, spots taken in its area, the line.
  const [quote, setQuote] = useState<PromotionQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const loadQuote = useCallback(async (id: string) => {
    setQuoteFailed(false);
    try {
      setQuote(await promotionQuote(id));
    } catch (e) {
      reportError(e, 'promote-quote');
      setQuoteFailed(true);
    }
  }, []);
  useEffect(() => {
    setQuote(null);
    if (taskId) void loadQuote(taskId);
  }, [taskId, loadQuote]);

  const dayList = quote?.days?.length ? quote.days : [...PROMOTE_DEFAULTS.DAYS];
  const dayPrice = quote?.dayPriceMinor ?? PROMOTE_DEFAULTS.DAY_PRICE_MINOR;
  const line = quote?.line ?? null;
  const [chosenDays, setChosenDays] = useState<number | null>(null);
  // A held spot keeps the length the person queued for; otherwise the middle one.
  const days =
    line?.status === 'offered' && dayList.includes(line.days)
      ? line.days
      : chosenDays && dayList.includes(chosenDays)
        ? chosenDays
        : (dayList[1] ?? dayList[0]!);
  const totalMinor = promotionPriceMinor(days, dayPrice);

  const live = quote?.promotion?.status === 'active' ? quote.promotion : null;
  const full = Boolean(quote && quote.taken >= quote.cap && !line);
  const inLine = line?.status === 'waiting';
  const held = line?.status === 'offered';
  const service = worker || quote?.kind === 'service';
  const noAlert = service || Boolean(quote?.remote);
  const radius = quote?.radiusKm ?? 10;

  const label = (s: string, extra?: TextStyle, color?: string) => (
    <RNText style={tx('400', 11, color ?? t.colors.muted, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  /** A refusal that means "the area filled up while you looked": show the Full state instead of an error. */
  const handleRefusal = async (e: unknown, fallback: string) => {
    const msg = messageOf(e, fallback);
    if (/join the line/i.test(msg) && taskId) {
      await loadQuote(taskId);
      flash('That area just filled up. You can join the line.');
    } else {
      flash(msg);
    }
  };

  /**
   * Buy the placement.
   *
   * A promotion is a real row that stays pending until its payment settles: the server will not
   * switch it on without a paid payment, so abandoning the payment page gets you nothing rather
   * than free advertising. The price is flat: days x the day price.
   */
  const start = async () => {
    if (busy) return;
    if (!taskId) {
      flash(
        mine.length === 0
          ? 'You have no open posts to promote yet'
          : 'Pick which post to promote first',
      );
      return;
    }
    setBusy(true);
    try {
      const promo = await startPromotion(taskId, days, totalMinor);
      const { paymentId, url } = await createPaymentLink({
        purpose: 'promotion',
        promotionId: promo.id,
        returnUrl: paymentReturnUrl(),
      });
      setPending({ promotionId: promo.id, paymentId });
      if (Platform.OS === 'web') await Linking.openURL(url);
      else setPayUrl(url);
      flash('Finish the payment, then come back and tap Activate');
    } catch (e) {
      await handleRefusal(e, 'Could not start that promotion');
    } finally {
      setBusy(false);
    }
  };

  /** Switch it on, once the money is actually in. */
  const activate = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const { status } = await syncPayment(pending.paymentId);
      if (status !== 'paid') {
        flash('No payment seen yet — it can take a few seconds');
        return;
      }
      await activatePromotion(pending.promotionId, pending.paymentId);
      celebrate(`Promoted · ${formatINR(totalMinor)} for ${daysLabel(days)}`);
      go(worker ? 'home' : 'orders');
    } catch (e) {
      flash(messageOf(e, 'Could not activate that promotion'));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (busy || !taskId) return;
    setBusy(true);
    try {
      setQuote(await joinPromotionLine(taskId, days));
      flash('You are in line. Nothing has been charged.');
    } catch (e) {
      await handleRefusal(e, 'Could not join the line');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (busy || !taskId) return;
    setBusy(true);
    try {
      setQuote(await leavePromotionLine(taskId));
      flash('You left the line');
    } catch (e) {
      flash(messageOf(e, 'Could not leave the line'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * What promoting does, in plain words. Everything in here has to stay true of what the code does.
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
            A promoted post is shown above the others and is always labelled “Promoted”. It buys
            position, nothing else.
          </RNText>

          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 18 })}>Why there is a limit</RNText>
          <RNText style={tx('400', 14, t.colors.text, { marginTop: 6, lineHeight: 21 })}>
            Only {quote?.cap ?? 3} posts can be promoted in one area at a time, and they share the top 2
            spots in turns, so each promoted post really gets seen. When it is full you can join the
            line. It is first come, first served.
          </RNText>

          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 18 })}>What it does not do</RNText>
          <RNText style={tx('400', 14, t.colors.text, { marginTop: 6, lineHeight: 21 })}>
            It does not make anyone send an offer, and it does not change your price. If a post has been
            up a while with no offers, the price is usually the reason, not the position.
          </RNText>

          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 18, lineHeight: 18 })}>
            You pay once, up front, for the days you choose. It does not renew. Stop any time: unused
            full days come back to you.
          </RNText>

          <Pressable
            onPress={() => setExplaining(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => ({
              marginTop: 20,
              backgroundColor: t.colors.btn,
              borderRadius: 999,
              paddingVertical: 14,
              alignItems: 'center',
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <RNText style={tx('700', 15, t.colors.onBtn)}>Got it</RNText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  // ---- what the main button does, per state ----
  const startLabel = busy
    ? 'Working…'
    : pending
      ? 'Activate promotion'
      : `Promote for ${daysLabel(days)} · ${formatINR(totalMinor)}`;
  const mainAction: { label: string; outline: boolean; onPress: () => void } | null = !taskId || live
    ? null
    : inLine
      ? { label: busy ? 'Working…' : 'Leave the line', outline: true, onPress: () => void leave() }
      : full && !pending
        ? {
            label: busy ? 'Working…' : `Join the line · you would be #${(quote?.waiting ?? 0) + 1}`,
            outline: true,
            onPress: () => void join(),
          }
        : { label: startLabel, outline: false, onPress: () => void (pending ? activate() : start()) };

  const footNote = inLine
    ? 'Nothing has been charged.'
    : full && !pending
      ? 'Free to join. When your turn comes we hold the spot for you for 30 minutes and send one alert. You pay only then, or skip and the next person gets it.'
      : 'Always labelled “Promoted”. It doesn’t change your price or make anyone send an offer. Stop any time: unused full days come back to you.';

  // ---- pieces of the page ----
  const rows: { icon: IconName; title: string; body: string; show: boolean }[] = [
    {
      icon: 'trending',
      title: service ? 'Top of the helpers list' : 'Top of Find work',
      body: service
        ? 'Shown above other helpers to people whose filters match you, in the list and on their Home.'
        : 'Shown above other tasks to workers whose filters match it, in the list and on their Home.',
      show: true,
    },
    {
      icon: 'map',
      title: 'Stands out on the map',
      body: 'A bigger pin with a ring, drawn above the others.',
      show: true,
    },
    {
      icon: 'bell',
      title: 'One alert to nearby workers',
      body: 'Sent once, to up to 30 workers near the task who were active this week.',
      show: !noAlert,
    },
    {
      icon: 'eye',
      title: 'Live results for you',
      body: 'How many saw it, opened it and sent an offer.',
      show: true,
    },
  ];

  const benefitRows = (
    <View style={{ marginTop: 14 }}>
      {rows
        .filter((r) => r.show)
        .map((r) => (
          <View key={r.title} style={{ flexDirection: 'row', gap: 12, paddingVertical: 9 }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                backgroundColor: t.colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={r.icon} size={17} color={t.colors.accentDeep} strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <RNText style={tx('700', 14, t.colors.ink)}>{r.title}</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2, lineHeight: 17 })}>{r.body}</RNText>
            </View>
          </View>
        ))}
    </View>
  );

  const nearbyBox =
    quote && !quote.remote ? (
      <View
        style={{
          marginTop: 12,
          backgroundColor: t.colors.accentSoft,
          borderWidth: 1,
          borderColor: t.colors.accentBorder,
          borderRadius: 12,
          paddingVertical: 13,
          paddingHorizontal: 16,
        }}
      >
        {label(service ? 'NEAR THIS SERVICE NOW' : 'NEAR THIS TASK NOW', {}, t.colors.accentDeep)}
        <RNText style={tx('700', 15, t.colors.ink, { marginTop: 4 })}>
          {quote.nearbyActive} {service ? 'people' : 'workers'} active this week within 10 km
        </RNText>
        {quote.taken > 0 && quote.taken < quote.cap ? (
          <>
            <View style={{ height: 1, backgroundColor: t.colors.accentBorder, marginVertical: 10 }} />
            {label(`BUSY HERE · ${quote.taken} other ${quote.taken === 1 ? 'task' : 'tasks'} promoted within ${radius} km`, {}, t.colors.accentDeep)}
            <RNText style={tx('400', 12, t.colors.text, { marginTop: 4, lineHeight: 17 })}>
              You share the top 2 spots with them in turns.
            </RNText>
          </>
        ) : null}
      </View>
    ) : null;

  const fullBox =
    quote && full ? (
      <View
        style={{
          marginTop: 12,
          backgroundColor: t.colors.signalSoft,
          borderWidth: 1,
          borderColor: t.colors.signal,
          borderRadius: 12,
          paddingVertical: 13,
          paddingHorizontal: 16,
        }}
      >
        {label(
          `FULL HERE RIGHT NOW · ${quote.cap} of ${quote.cap} promotion spots within ${radius} km are taken`,
          {},
          t.colors.signalDeep,
        )}
        <RNText style={tx('400', 13, t.colors.text, { marginTop: 6, lineHeight: 19 })}>
          {quote.nextFreeAt ? `The next one opens ${whenText(quote.nextFreeAt)}. ` : ''}
          {quote.waiting} {quote.waiting === 1 ? 'person is' : 'people are'} already in line. We keep it to {quote.cap} so
          each promoted post really gets seen. The line is first come, first served.
        </RNText>
      </View>
    ) : null;

  const lineCard =
    quote && line && inLine ? (
      <View
        style={{
          marginTop: 12,
          backgroundColor: t.colors.accentSoft,
          borderWidth: 1,
          borderColor: t.colors.accentBorder,
          borderRadius: 12,
          padding: 16,
        }}
      >
        {label('YOU ARE IN LINE', {}, t.colors.accentDeep)}
        <RNText style={tx('800', 20, t.colors.ink, { marginTop: 4 })}>
          #{line.position} of {quote.waiting + 1} waiting near here
        </RNText>
        <RNText style={tx('400', 13, t.colors.text, { marginTop: 6, lineHeight: 19 })}>
          All {quote.cap} spots within {radius} km are taken.
          {quote.nextFreeAt ? ` The next one should open ${whenText(quote.nextFreeAt)}.` : ''} You joined at{' '}
          {clockText(line.joinedAt)}.
        </RNText>
        {[
          'When a spot is yours, you get one alert and we hold it for 30 minutes.',
          'You pay then, at the same price as everyone, and it goes live at once.',
          'Miss it and the spot goes to the next person. You can join again.',
        ].map((s, i) => (
          <View key={s} style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: t.colors.btn,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx('700', 12, t.colors.onBtn)}>{i + 1}</RNText>
            </View>
            <RNText style={tx('400', 13, t.colors.text, { flex: 1, lineHeight: 19 })}>{s}</RNText>
          </View>
        ))}
      </View>
    ) : null;

  const heldCard =
    held && line ? (
      <View
        style={{
          marginTop: 12,
          backgroundColor: t.colors.accentSoft,
          borderWidth: 2,
          borderColor: t.colors.accent,
          borderRadius: 12,
          padding: 16,
        }}
      >
        {label(`YOUR SPOT IS FREE · held for you until ${clockText(line.offeredUntil)}`, {}, t.colors.accentDeep)}
        <RNText style={tx('400', 13, t.colors.text, { marginTop: 6, lineHeight: 19 })}>
          Promote now to take it. If you skip, the next person in line gets it.
        </RNText>
      </View>
    ) : null;

  const daysPicker = (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, ...(desktop ? { maxWidth: 440 } : null) }}>
      {dayList.map((d) => {
        const on = d === days;
        const locked = held && line?.days !== d;
        return (
          <Pressable
            key={d}
            disabled={locked}
            onPress={() => setChosenDays(d)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 10,
              paddingVertical: 10,
              alignItems: 'center',
              backgroundColor: on ? t.colors.accentSoft : 'transparent',
              borderWidth: 1,
              borderColor: on ? t.colors.accent : t.colors.line,
              opacity: locked ? 0.4 : 1,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <RNText style={tx('700', 13, on ? t.colors.ink : t.colors.muted)}>{daysLabel(d)}</RNText>
            <RNText style={tx('400', 12, on ? t.colors.accentDeep : t.colors.muted, { marginTop: 2 })}>
              {formatINR(promotionPriceMinor(d, dayPrice))}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );

  const mainButtonPhone = mainAction ? (
    <Pressable
      onPress={mainAction.onPress}
      disabled={busy}
      style={({ pressed }) => ({
        backgroundColor: mainAction.outline ? 'transparent' : t.colors.btn,
        borderWidth: mainAction.outline ? 1.5 : 0,
        borderColor: t.colors.accent,
        borderRadius: 999,
        paddingVertical: 16,
        alignItems: 'center',
        ...(mainAction.outline
          ? null
          : {
              shadowColor: t.colors.accent,
              shadowOpacity: 0.35,
              shadowRadius: 22,
              shadowOffset: { width: 0, height: 8 },
              elevation: 6,
            }),
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <RNText style={tx('700', 16, mainAction.outline ? t.colors.accentDeep : t.colors.onBtn)}>{mainAction.label}</RNText>
    </Pressable>
  ) : null;

  return (
    <Screen padded={false}>
      {desktop ? <TopBar title={service ? 'Promote this service' : 'Promote this task'} onBack={back} /> : null}
      <FormPage
        phoneActions="pinned"
        scrollProps={{
          hugContent: true,
          style: { flex: 1 },
          contentContainerStyle: { paddingHorizontal: 20, paddingTop: 8 },
          showsVerticalScrollIndicator: false,
        }}
        aside={
          <>
            <Pressable
              onPress={() => setExplaining(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="How promotion works"
              style={{ alignSelf: 'flex-start' }}
            >
              <RNText style={tx('700', 12, t.colors.accentDeep, { textDecorationLine: 'underline' })}>How this works</RNText>
            </Pressable>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 14, lineHeight: 17 })}>{footNote}</RNText>
          </>
        }
        actions={
          mainAction ? (
            desktop ? (
              <ActionBar>
                <PrimaryButton
                  label={mainAction.label}
                  tone={mainAction.outline ? 'quiet' : 'accent'}
                  busy={busy}
                  onPress={mainAction.onPress}
                />
              </ActionBar>
            ) : (
              <KeyboardSafe style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
                {mainButtonPhone}
                <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10, lineHeight: 17 })}>
                  {footNote}
                </RNText>
              </KeyboardSafe>
            )
          ) : undefined
        }
      >
        {desktop ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <BackButton onBack={back} title={service ? 'Promote this service' : 'Promote this task'} />
            {systemHeader ? null : (
              <RNText style={tx('700', 17, t.colors.ink)}>
                {service ? 'Promote this service' : 'Promote this task'}
              </RNText>
            )}
          </View>
        )}

        <FormSection first title="Which post">
        <View style={{ marginTop: desktop ? 0 : 14 }}>
          {loadingMine ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 }}>
              <ActivityIndicator size="small" color={t.colors.muted} />
              <RNText style={tx('400', 13, t.colors.muted)}>Finding your posts…</RNText>
            </View>
          ) : loadFailed && !picked ? (
            <LoadFailed title="Couldn’t load your posts" onRetry={() => setAttempt((n) => n + 1)} />
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
                Only your own open posts can be promoted. Post one, or reopen a closed one,
                and it will show up here.
              </RNText>
            </View>
          ) : (
            <>
              {desktop ? null : (
                <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>
                  WHICH POST
                </RNText>
              )}

              {/* One line when settled; the full list only while choosing. */}
              {picked && !choosing ? (
                <Pressable
                  onPress={() => setChoosing(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Change post, currently ${picked.title}`}
                  style={({ pressed }) => ({
                    marginTop: desktop ? 0 : 9,
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
                      {picked.quotes === 1 ? '1 offer' : `${picked.quotes} offers`}
                    </RNText>
                  </View>
                  {mine.length > 1 && (
                    <RNText style={tx('700', 12, t.colors.accentDeep)}>Change</RNText>
                  )}
                </Pressable>
              ) : (
                <>
                  <View {...ring}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 9,
                      marginTop: desktop ? 0 : 9,
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
                      placeholder="Search your posts"
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
                      {listingQuery.trim()
                        ? `Nothing matches “${listingQuery.trim()}”. Only your own open posts can be promoted.`
                        : `Type a word from the title to find the post you want to promote (${mine.length} open).`}
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
                          {m.quotes === 1 ? '1 offer' : `${m.quotes} offers`}
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
        </FormSection>

        {taskId && quoteFailed && !quote ? (
          <View style={{ marginTop: 16 }}>
            <LoadFailed title="Couldn’t load the promotion details" onRetry={() => void loadQuote(taskId)} />
          </View>
        ) : null}

        {live ? (
          <View style={{ marginTop: 16 }}>
            <PromotionResultsCard promotionId={live.id} service={service} onChanged={() => taskId && void loadQuote(taskId)} />
          </View>
        ) : taskId ? (
          <>
            <RNText style={tx('800', 20, t.colors.ink, { marginTop: 20, letterSpacing: -0.4 })}>
              {service ? 'Get more customers to see it' : 'Get more workers to see it'}
            </RNText>
            {benefitRows}
            {inLine ? lineCard : full ? fullBox : nearbyBox}
            {held ? heldCard : null}
            {inLine ? null : (
              <FormSection title="How long">
                {desktop ? null : label('HOW LONG', { marginTop: 18 })}
                {daysPicker}
              </FormSection>
            )}
          </>
        ) : null}
      </FormPage>
      {explainer}
      <PaymentSheet url={payUrl} visible={payUrl !== null} onClose={() => setPayUrl(null)} />
    </Screen>
  );
}
