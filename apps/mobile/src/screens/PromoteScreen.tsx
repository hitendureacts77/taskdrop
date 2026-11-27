import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, Modal, TextInput, Linking, Platform, type TextStyle } from 'react-native';
import { PROMOTE_DEFAULTS } from '@taskdrop/rules';
import { Screen, Chip, formatINR } from '../components/ui';
import { ConfirmDialog, LoadFailed, PrimaryButton, Shimmer, TopBar } from '../components/kit';
import { reportError, messageOf } from '../lib/errors';
import { useTheme, PersonTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import {
  startPromotion,
  createPaymentLink,
  syncPayment,
  activatePromotion,
  cancelPromotion,
  listPromotions,
  getTask,
  promotionQuote,
  type PromotionQuote,
} from '../data/api';
import { PromotionsScreen } from './PromotionsScreen';
import { PaymentSheet } from '../components/PaymentSheet';
import { PromotionResultsCard } from '../components/PromotionResultsCard';
import { paymentReturnUrl } from '../lib/links';
import {
  BUDGET_PRESETS_RUPEES,
  DEFAULT_BUDGET_RUPEES,
  PAYMENT_FAILED,
  busyNote,
  campaignEndIso,
  campaignTotalMinor,
  clampBudget,
  confirmCopy,
  daysLabel,
  estimateNote,
  estimateText,
  limitsFrom,
  moneyText,
  parseBudget,
  payNote,
  raisedBudget,
  refusalProblem,
  type PromoteProblem,
} from '../lib/promoteText';
import { tx } from '../components/primitives';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { KeyboardScrollView } from '../components/KeyboardScrollView';

/**
 * Promote a post with a daily budget. A task's poster is always in the Hire (jade) palette and a service
 * owner in the Earn (blue) one, whatever mode the app is in (PersonTheme swaps the accent tokens).
 * The whole budget is paid upfront and the promotion always runs to the end: no stop, no refund.
 */
export function PromoteScreen() {
  const { mode } = useMode();
  const { params } = useNav();
  // No post chosen (an old link, or a menu entry from before): the merged Promotions screen is where one is picked.
  if (typeof params.taskId !== 'string') return <PromotionsScreen />;
  return (
    <PersonTheme role={mode === 'worker' ? 'worker' : 'poster'}>
      <PromoteBody />
    </PersonTheme>
  );
}

function PromoteBody() {
  const t = useTheme();
  const { back, params } = useNav();
  const { mode } = useMode();
  const { celebrate, flash } = useActions();
  const [busy, setBusy] = useState(false);
  // Native: the checkout opens in a sheet here rather than in Chrome.
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<{ promotionId: string; paymentId: string } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<PromoteProblem | null>(null);

  // Which listing is being promoted: chosen on the Promotions screen and passed in. Its title and price are read for the header card.
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  const [picked, setPicked] = useState<{ title: string; benchmark_minor: number } | null>(null);
  useEffect(() => {
    setPicked(null);
    if (!taskId) return;
    let alive = true;
    void getTask(taskId)
      .then((tk) => alive && tk && setPicked({ title: tk.title, benchmark_minor: tk.benchmark_minor ?? 0 }))
      .catch((e) => reportError(e, 'promote-task'));
    return () => {
      alive = false;
    };
  }, [taskId]);

  const worker = mode === 'worker';

  // The server's view of this post: budget limits, lengths, how busy the area is, its campaign.
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

  // Opened from a notification or the list: show how an ended promotion did, until "Promote again".
  const [showResults, setShowResults] = useState(params.results === true);
  const [pastId, setPastId] = useState<string | null>(null);
  useEffect(() => {
    setPastId(null);
    if (!showResults || !taskId) return;
    let alive = true;
    void listPromotions()
      .then((rows) => {
        const latest = rows
          .filter((p) => p.task_id === taskId && p.status !== 'pending' && (p.status !== 'cancelled' || p.starts_at))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        if (alive) setPastId(latest?.id ?? null);
      })
      .catch((e) => reportError(e, 'promote-past'));
    return () => {
      alive = false;
    };
  }, [showResults, taskId]);

  const limits = limitsFrom(quote?.minDayMinor, quote?.maxDayMinor);
  const dayList = quote?.days?.length ? quote.days : [...PROMOTE_DEFAULTS.DAYS];
  const [chosenDays, setChosenDays] = useState<number | null>(null);
  const days = chosenDays && dayList.includes(chosenDays) ? chosenDays : (dayList[1] ?? dayList[0]!);

  // The daily budget: a quick amount, or "Other" with a typed one.
  const [chosen, setChosen] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const custom = parseBudget(customText, limits);
  const budget = customOpen ? custom.rupees : (chosen ?? clampBudget(DEFAULT_BUDGET_RUPEES, limits));
  const dayMinor = budget === null ? null : budget * 100;
  const totalMinor = dayMinor === null ? null : campaignTotalMinor(dayMinor, days);

  const live = quote?.promotion?.status === 'active' ? quote.promotion : null;
  const waitingPromo = quote?.promotion?.status === 'pending' && !pending ? quote.promotion : null;
  const service = worker || quote?.kind === 'service';
  const post = service ? 'service' : 'task';
  const resultsId = live?.id ?? (showResults && !quote?.promotion ? pastId : null);
  const raised = budget === null ? null : raisedBudget(budget, limits);
  const busyBox = quote && !quote.remote ? busyNote(quote.others, quote.areaKm, quote.areaPriceMinor) : null;

  const label = (s: string, extra?: TextStyle, color?: string) => (
    <RNText style={tx('800', 10, color ?? t.colors.muted, { letterSpacing: 1.2, ...extra })}>{s}</RNText>
  );

  /**
   * Buy the promotion. It stays pending until its payment settles: the server will not switch it on without
   * a paid payment, so abandoning the payment page gets you nothing rather than free advertising.
   */
  const start = async () => {
    if (busy || !taskId || totalMinor === null) return;
    setConfirming(false);
    setProblem(null);
    setBusy(true);
    try {
      let promoId: string;
      try {
        promoId = (await startPromotion(taskId, days, totalMinor)).id;
      } catch (e) {
        const msg = messageOf(e, 'Could not start that promotion');
        const known = refusalProblem(msg, limits, service);
        setProblem(known ?? { title: "Couldn't start the promotion.", body: msg });
        // Already running (or the post changed): the screen should show what the server has.
        await loadQuote(taskId);
        return;
      }
      try {
        const { paymentId, url } = await createPaymentLink({ purpose: 'promotion', promotionId: promoId, returnUrl: paymentReturnUrl() });
        setPending({ promotionId: promoId, paymentId });
        if (Platform.OS === 'web') await Linking.openURL(url);
        else setPayUrl(url);
        flash('Finish the payment, then come back and tap Activate');
      } catch (e) {
        reportError(e, 'promote-payment');
        setProblem(PAYMENT_FAILED);
        await loadQuote(taskId);
      }
    } finally {
      setBusy(false);
    }
  };

  /** Switch it on, once the money is actually in. */
  const activate = async () => {
    if (!pending || busy || !taskId) return;
    setBusy(true);
    try {
      const { status } = await syncPayment(pending.paymentId);
      if (status !== 'paid') {
        flash('No payment seen yet — it can take a few seconds');
        return;
      }
      await activatePromotion(pending.promotionId, pending.paymentId);
      celebrate(`Promoted · ${moneyText(totalMinor ?? 0)} for ${daysLabel(days)}`);
      setPending(null);
      setShowResults(false);
      await loadQuote(taskId);
    } catch (e) {
      flash(messageOf(e, 'Could not activate that promotion'));
    } finally {
      setBusy(false);
    }
  };

  /** A promotion that was started but never paid can be dropped. A paid one never can. */
  const dropUnpaid = async () => {
    if (!waitingPromo || busy || !taskId) return;
    setBusy(true);
    try {
      await cancelPromotion(waitingPromo.id);
      setProblem(null);
      await loadQuote(taskId);
    } catch (e) {
      flash(messageOf(e, 'Could not cancel that'));
    } finally {
      setBusy(false);
    }
  };

  const sheet = (
    <Modal visible={explaining} transparent animationType="slide" onRequestClose={() => setExplaining(false)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={() => setExplaining(false)} accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 28, gap: 11 }}>
          <RNText style={tx('800', 17, t.colors.ink, { letterSpacing: -0.3 })}>How bidding works</RNText>
          {[
            service
              ? 'When a customer nearby opens the helpers list or searches, every promoted service that suits them enters a quick auction.'
              : 'When a worker nearby opens Find work, every promoted task that suits them enters a quick auction.',
            `Bigger budget and a nearer ${post} give a higher score. The ${PROMOTE_DEFAULTS.TOP_SLOTS} best go on top.`,
            `You pay just enough to beat the next ${post}, never more than your bid, and at least ${moneyText(PROMOTE_DEFAULTS.FLOOR_MINOR)} a show.`,
            `Each ${service ? 'customer' : 'worker'} counts at most ${PROMOTE_DEFAULTS.VIEWER_TOP_PER_DAY} times a day. A quiet day's leftover moves to the next day, and if money is still left at the end it runs on up to ${PROMOTE_DEFAULTS.RUN_ON_DAYS} more days.`,
          ].map((s, i) => (
            <View key={s} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <RNText style={tx('800', 12, t.colors.accentDeep)}>{i + 1}</RNText>
              </View>
              <RNText style={tx('400', 13, t.colors.text, { flex: 1, lineHeight: 19 })}>{s}</RNText>
            </View>
          ))}
          <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.line, borderRadius: 12, padding: 10 }}>
            <RNText style={tx('400', 12, t.colors.muted, { lineHeight: 17 })}>
              This is how Meta and Google sell ad space too. There is no fixed price: busy areas cost more, quiet areas cost less.
            </RNText>
          </View>
          <PrimaryButton label="Got it" onPress={() => setExplaining(false)} />
        </View>
      </View>
    </Modal>
  );

  const problemBox = (p: PromoteProblem) => (
    <View style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: t.colors.signal, backgroundColor: t.colors.signalSoft, paddingVertical: 10, paddingHorizontal: 12 }}>
      <RNText style={tx('400', 12, t.colors.ink, { lineHeight: 17 })}>
        <RNText style={tx('800', 12, t.colors.signalDeep)}>{p.title} </RNText>
        {p.body}
      </RNText>
    </View>
  );

  const postCard = picked ? (
    <Pressable
      onPress={back}
      accessibilityRole="button"
      accessibilityLabel={`Change post, currently ${picked.title}`}
      style={({ pressed }) => ({
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderRadius: 12,
        paddingVertical: 9,
        paddingHorizontal: 11,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>
          {picked.title}
        </RNText>
        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 1 })}>{formatINR(picked.benchmark_minor)}</RNText>
      </View>
      <RNText style={tx('700', 12, t.colors.accentDeep)}>Change</RNText>
    </Pressable>
  ) : null;

  const budgetBlock = (
    <View style={{ marginTop: 16 }}>
      {label('SPEND UP TO, PER DAY')}
      <RNText style={tx('800', 26, t.colors.accentDeep, { letterSpacing: -0.5, marginTop: 2 })}>{budget === null ? '—' : moneyText(budget * 100)}</RNText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {BUDGET_PRESETS_RUPEES.filter((p) => p >= limits.minRupees && p <= limits.maxRupees).map((p) => (
          <Chip
            key={p}
            label={moneyText(p * 100)}
            active={!customOpen && budget === p}
            onPress={() => {
              setCustomOpen(false);
              setChosen(p);
              setProblem(null);
            }}
          />
        ))}
        <Chip
          label="Other"
          active={customOpen}
          onPress={() => {
            setCustomOpen(true);
            setCustomText(budget !== null ? String(budget) : '');
          }}
        />
      </View>
      {customOpen ? (
        <View style={{ marginTop: 10 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderWidth: 1.5,
              borderColor: custom.error ? t.colors.signal : t.colors.line,
              borderRadius: 12,
              paddingHorizontal: 11,
              paddingVertical: 9,
            }}
          >
            <RNText style={tx('700', 15, t.colors.muted)}>₹</RNText>
            <TextInput
              value={customText}
              onChangeText={setCustomText}
              keyboardType="number-pad"
              placeholder={`${limits.minRupees} to ${limits.maxRupees}`}
              placeholderTextColor={t.colors.muted}
              accessibilityLabel="Daily budget in rupees"
              style={tx('700', 15, t.colors.ink, { flex: 1, padding: 0 })}
            />
          </View>
          {custom.error ? <RNText style={tx('600', 11, t.colors.signalDeep, { marginTop: 4 })}>{custom.error}</RNText> : null}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <RNText style={tx('400', 10, t.colors.muted)}>{moneyText(limits.minRupees * 100)}</RNText>
          <RNText style={tx('400', 10, t.colors.muted)}>{moneyText(limits.maxRupees * 100)}</RNText>
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        {label('FOR')}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 5 }}>
          {dayList.map((d) => (
            <Chip key={d} label={daysLabel(d)} active={d === days} onPress={() => setChosenDays(d)} />
          ))}
        </View>
      </View>
    </View>
  );

  const estimateBlock =
    !quote ? (
      <View style={{ marginTop: 14 }}>
        <Shimmer height={86} />
      </View>
    ) : (
      <>
        {busyBox ? (
          <View style={{ marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: t.colors.gold, backgroundColor: t.colors.goldSoft, paddingVertical: 10, paddingHorizontal: 12 }}>
            <RNText style={tx('400', 12, t.colors.ink, { lineHeight: 17 })}>
              <RNText style={tx('800', 12, t.colors.goldInk)}>{busyBox.title} </RNText>
              {busyBox.body}
            </RNText>
          </View>
        ) : null}
        {dayMinor !== null ? (
          <View style={{ marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentSoft, paddingVertical: 11, paddingHorizontal: 12 }}>
            {label(`ESTIMATE FOR ${moneyText(dayMinor).toUpperCase()} A DAY`, {}, t.colors.accentDeep)}
            <RNText style={tx('800', 20, t.colors.ink, { marginTop: 2 })}>{estimateText(dayMinor, quote.areaPriceMinor)}</RNText>
            {(() => {
              const note = estimateNote({ others: quote.others, areaKm: quote.areaKm, areaPriceMinor: quote.areaPriceMinor, remote: quote.remote, service, raisedRupees: raised });
              return note ? <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3, lineHeight: 15 })}>{note}</RNText> : null;
            })()}
          </View>
        ) : null}
        {busyBox && raised !== null && budget !== null ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
            <Chip label={`Keep ${moneyText(budget * 100)}`} active={budget !== raised} onPress={() => undefined} />
            <Chip
              label={`Use ${moneyText(raised * 100)}`}
              onPress={() => {
                setCustomOpen(false);
                setChosen(raised);
              }}
            />
          </View>
        ) : null}
      </>
    );

  const howLink = (
    <Pressable onPress={() => setExplaining(true)} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', marginTop: 14 }}>
      <RNText style={tx('700', 12, t.colors.accentDeep, { textDecorationLine: 'underline' })}>How bidding works</RNText>
    </Pressable>
  );

  const waitingBox = waitingPromo ? (
    <View style={{ marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentSoft, padding: 12 }}>
      <RNText style={tx('700', 13, t.colors.ink)}>A promotion is waiting for payment.</RNText>
      <RNText style={tx('400', 12, t.colors.text, { marginTop: 4, lineHeight: 17 })}>
        It starts only after it is paid. If you left the payment page, cancel this one and start again. Nothing was charged.
      </RNText>
      <View style={{ marginTop: 10 }}>
        <PrimaryButton label="Cancel it and start again" tone="quiet" busy={busy} onPress={() => void dropUnpaid()} />
      </View>
    </View>
  ) : null;

  const formReady = Boolean(taskId && quote && !quote.promotion && dayMinor !== null && totalMinor !== null) || Boolean(pending);
  const canPay = Boolean(taskId && quote && !waitingPromo && dayMinor !== null && totalMinor !== null) || Boolean(pending);
  const showForm = taskId && !resultsId && !(showResults && !quote && !pastId);
  const confirm = confirmCopy(totalMinor ?? 0, days, campaignEndIso(days));
  const title = resultsId ? 'Promotion' : service ? 'Promote my service' : 'Promote this task';

  return (
    <Screen padded={false}>
      <TopBar title={title} onBack={back} />
      <KeyboardScrollView hugContent style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {postCard}

        {taskId && quoteFailed && !quote ? (
          <View style={{ marginTop: 16 }}>
            <LoadFailed title="Couldn’t load the promotion details" onRetry={() => void loadQuote(taskId)} />
          </View>
        ) : null}

        {problem ? problemBox(problem) : null}

        {resultsId ? (
          <View style={{ marginTop: 14 }}>
            <PromotionResultsCard promotionId={resultsId} service={service} onPromoteAgain={() => setShowResults(false)} />
          </View>
        ) : showForm ? (
          <>
            {waitingBox}
            {waitingPromo ? null : (
              <>
                {budgetBlock}
                {estimateBlock}
                {howLink}
              </>
            )}
          </>
        ) : null}
      </KeyboardScrollView>

      {showForm && !waitingPromo && quote ? (
        <KeyboardSafe style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, borderTopWidth: 1, borderTopColor: t.colors.line, backgroundColor: t.colors.bg }}>
          <PrimaryButton
            label={
              busy
                ? 'Working…'
                : pending
                  ? 'Activate promotion'
                  : totalMinor === null
                    ? 'Promote'
                    : `Promote · ${moneyText(totalMinor)} for ${daysLabel(days)}`
            }
            busy={busy}
            disabled={!canPay || !formReady}
            onPress={() => (pending ? void activate() : setConfirming(true))}
          />
          {totalMinor !== null ? (
            <RNText style={tx('400', 11, t.colors.muted, { textAlign: 'center', marginTop: 8, lineHeight: 15 })}>
              {pending ? 'Finish the payment, then tap Activate. The promotion starts when it is paid.' : payNote(totalMinor, days)}
            </RNText>
          ) : null}
        </KeyboardSafe>
      ) : null}

      <ConfirmDialog
        visible={confirming}
        icon="wallet"
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirm}
        cancelLabel="Go back"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void start()}
      />
      {sheet}
      <PaymentSheet url={payUrl} visible={payUrl !== null} onClose={() => setPayUrl(null)} />
    </Screen>
  );
}
