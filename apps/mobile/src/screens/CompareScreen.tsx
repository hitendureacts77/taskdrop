import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import {
  View,
  Text as RNText,
  Pressable,
  ScrollView,
} from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { listBidsForTask, lockBid, getTask, WalletShortError, type Task } from '../data/api';
import { AddFundsSheet } from '../components/AddFundsSheet';
import { formatDeadline } from '../components/DateTimeSheet';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { TaskDescription } from '../components/TaskDescription';
import { TaskMediaThumb } from '../components/TaskMediaThumb';
import { AvatarPresence, PresenceLabel } from '../components/PresenceDot';

type Quote = {
  bidId?: string;
  who: string;
  rating: number;
  pro: boolean;
  meta: string;
  priceMinor: number;
  eta: string;
  lastSeen?: string | null;
};

/** "no jobs yet" / "1 job" / "12 jobs" - never "1 jobs". */
function jobsLabel(n: number): string {
  if (n === 0) return "no jobs yet";
  return n + (n === 1 ? " job" : " jobs");
}

/** The pillar as a poster would name it, not as the column spells it. */
/** Plain words for the task's state, instead of the raw database code. */
const STATUS_LABEL: Record<string, string> = {
  OPEN: 'OPEN',
  LOCKED: 'OFFER CHOSEN',
  TASK_STARTED: 'IN PROGRESS',
  OVERDUE: 'RUNNING LATE',
  WORK_DONE: 'READY TO CHECK',
  REVISION_REQUESTED: 'CHANGES ASKED',
  COMPLETED: 'DONE',
  AUTO_COMPLETED: 'DONE',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'PROBLEM REPORTED',
};

const PILLAR_LABEL: Record<string, string> = {
  services: 'SERVICES',
  procurement: 'GOODS & PRODUCTS',
  local_intel: 'LOCAL HELP',
};

/** Poster flow: incoming bids on a posted task, sortable, each lockable into escrow.
 * Pixel parity with docs/design/_design_markup.html lines 752-801. Data/handlers
 * mirror docs/design/_design_source.jsx lines 696-716. */
export function CompareScreen() {
  const t = useTheme();
  const { params, go, back } = useNav();
  const { flash, celebrate } = useActions();
  const [sortLow, setSortLow] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [rows, setRows] = useState<Quote[] | null>(null);
  const [busy, setBusy] = useState(false);
  // What the wallet is short by when an offer cannot be paid for yet.
  const [shortBy, setShortBy] = useState<number | null>(null);
  const [task, setTask] = useState<Task | null>(null);


  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  // The params paint the screen on the first frame; the fetched row replaces
  // them the moment it lands. Neither falls back to an invented request.
  const title = task?.title ?? (typeof params.title === 'string' ? params.title : '');
  const benchMinor =
    task?.benchmark_minor ?? (typeof params.priceMinor === 'number' ? params.priceMinor : 0);

  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    getTask(taskId)
      .then((row) => alive && setTask(row))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [taskId]);

  // Real quotes on this task. Without a task id (sample navigation) we keep the
  // design's example rows so the screen still reads correctly.
  useEffect(() => {
    let alive = true;
    if (!taskId) {
      setRows(null);
      return;
    }
    listBidsForTask(taskId)
      .then((bids) => {
        if (!alive) return;
        setRows(
          bids.map((b) => ({
            bidId: b.id,
            who: b.profiles?.display_name ?? 'Worker',
            rating: Number(b.profiles?.worker_rating_avg ?? 0) || 0,
            pro: false,
            meta: jobsLabel(b.profiles?.worker_rating_count ?? 0),
            priceMinor: b.price_minor,
            eta: `${Math.round(b.time_limit_minutes / 60)} hrs`,
            lastSeen: b.profiles?.last_seen_at ?? null,
          })),
        );
      })
      .catch(() => setRows([]));
    return () => {
      alive = false;
    };
  }, [taskId]);

  // No invented quotes. An empty list is a true statement about a new
  // request; four imaginary taskers with ratings is not.
  const source: Quote[] = rows ?? [];

  const sorted = useMemo(() => {
    const list = source.slice();
    list.sort((a, b) => (sortLow ? a.priceMinor - b.priceMinor : b.rating - a.rating));
    return list;
  }, [sortLow, source]);

  const pickRow = sorted.find((r) => r.who === picked) ?? sorted[0];

  // Sample navigation has no task behind it, so fall back to the design copy.
  const quoteCount = rows?.length ?? sorted.length;
  const headerLine = task
    ? (STATUS_LABEL[task.status] ?? 'OPEN') + ' · ' + quoteCount + (quoteCount === 1 ? ' OFFER' : ' OFFERS')
    : 'OPEN · ' + quoteCount + (quoteCount === 1 ? ' OFFER' : ' OFFERS');
  const completeBy = task
    ? formatDeadline(new Date(new Date(task.created_at).getTime() + task.time_limit_minutes * 60_000))
    : '9 Sep, 6 PM';

  const handleLock = async () => {
    if (!pickRow || busy) return;
    // Real quote -> lock it server-side (creates the assignment + escrow).
    if (pickRow.bidId) {
      setBusy(true);
      try {
        await lockBid(pickRow.bidId);
        celebrate(`${pickRow.who} is hired · paid from your wallet`);
        if (taskId) go('taskManage', { taskId });
      } catch (e) {
        if (e instanceof WalletShortError) setShortBy(e.shortMinor);
        else flash(e instanceof Error ? e.message : 'Could not choose that offer');
      } finally {
        setBusy(false);
      }
      return;
    }
    // No bid id means this is a sample quote. Sending someone to a payment
    // screen for it would take real money against an assignment that was never
    // created.
    flash('That is a sample offer — pick a real one from your requests');
  };

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="back" size={20} color={t.colors.ink} />
        </Pressable>

        <RNText style={tx('700', 10, t.colors.blue, { letterSpacing: 1.6, marginTop: 16 })}>
          {headerLine}
        </RNText>
        <RNText style={tx('800', 23, t.colors.ink, { letterSpacing: -0.69, marginTop: 9 })}>{title}</RNText>

        {/* The post, inside the screen that decides on it. A poster reading
            four quotes needs to see what he actually asked for — the words, the
            photo and the place — without going back to find them. */}
        {task?.pillar && (
          <RNText style={tx('700', 10, t.colors.muted, { letterSpacing: 1.6, marginTop: 10 })}>
            {PILLAR_LABEL[task.pillar] ?? String(task.pillar).toUpperCase()}
          </RNText>
        )}

        {task?.description ? (
          <View style={{ marginTop: 12 }}>
            <TaskDescription text={task.description} title={task.title} />
          </View>
        ) : null}

        {task?.media_path && (
          <View style={{ marginTop: 14, height: 200 }}>
            <TaskMediaThumb
              path={task.media_path}
              kind={task.media_kind === 'video' ? 'video' : 'image'}
              seconds={task.media_seconds ?? null}
              radius={14}
            />
          </View>
        )}

        {task?.loc_label ? (
          <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 12 })}>
            📍 {task.loc_label}
          </RNText>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            gap: 22,
            marginTop: 16,
            paddingVertical: 13,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: t.colors.line,
          }}
        >
          <View>
            <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>BUDGET</RNText>
            <RNText style={tx('800', 19, t.colors.accentDeep, { marginTop: 4 })}>{formatINR(benchMinor)}</RNText>
          </View>
          <View>
            <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>COMPLETE BY</RNText>
            <RNText style={tx('700', 19, t.colors.ink, { marginTop: 4 })}>{completeBy}</RNText>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>INCOMING OFFERS</RNText>
          {sorted.length > 1 && (
            <Pressable onPress={() => setSortLow((v) => !v)}>
              <RNText style={tx('700', 12, t.colors.accentDeep)}>
                Sort: {sortLow ? 'lowest' : 'rating'} ▾
              </RNText>
            </Pressable>
          )}
        </View>

        {sorted.map((row, i) => {
          const selected = row.who === picked;
          return (
            <FadeIn key={row.who} duration={340} delay={i * 70} style={{ marginTop: 11 }}>
              <Pressy
                onPress={() => setPicked(row.who)}
                scaleTo={0.985}
                style={{
                  backgroundColor: selected ? t.colors.accentSoft : t.colors.surface,
                  borderWidth: 1,
                  borderColor: selected ? t.colors.accent : t.colors.line,
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      backgroundColor: t.colors.surface2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="user" size={15} color={t.colors.muted} />
                    {row.bidId ? <AvatarPresence lastSeen={row.lastSeen} ring={t.colors.surface} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <RNText style={tx('700', 15, t.colors.ink)}>{row.who}</RNText>
                      <RNText style={tx('400', 12, t.colors.muted)}>★ {row.rating.toFixed(1)}</RNText>
                      {row.pro && (
                        <View style={{ backgroundColor: t.colors.accent, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5 }}>
                          <RNText style={tx('800', 9, t.colors.onAccent, { letterSpacing: 1.08 })}>PRO</RNText>
                        </View>
                      )}
                    </View>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>{row.meta}</RNText>
                    {row.bidId ? (
                      <View style={{ marginTop: 4 }}>
                        <PresenceLabel lastSeen={row.lastSeen} />
                      </View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <RNText style={tx('800', 17, t.colors.ink)}>{formatINR(row.priceMinor)}</RNText>
                    <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>{row.eta}</RNText>
                  </View>
                </View>
                {selected && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 7,
                      marginTop: 11,
                      paddingTop: 11,
                      borderTopWidth: 1,
                      borderTopColor: t.colors.accentBorder,
                    }}
                  >
                    <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: t.colors.accent }} />
                    <RNText style={tx('700', 11, t.colors.accentDeep, { letterSpacing: 1.54 })}>SELECTED</RNText>
                  </View>
                )}
              </Pressy>
            </FadeIn>
          );
        })}

        {sorted.length === 0 && (
          <View
            style={{
              marginTop: 12,
              borderWidth: 1,
              borderColor: t.colors.line,
              borderRadius: 14,
              backgroundColor: t.colors.surface,
              padding: 18,
            }}
          >
            <RNText style={tx('700', 15, t.colors.ink)}>No offers yet</RNText>
            <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 20 })}>
              Your request is live and workers nearby can see it. Offers land here as
              they come in, and nothing is charged until you choose one.
            </RNText>
          </View>
        )}

        {/* What a quote will look like when one arrives. Marked as an example
            and not tappable, so it can never be mistaken for a real offer. */}
        {sorted.length === 0 && (
          <View
            style={{
              marginTop: 12,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: t.colors.accentBorder,
              borderRadius: 14,
              padding: 15,
              opacity: 0.85,
            }}
            accessibilityLabel="Example of an offer"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ backgroundColor: t.colors.goldSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                <RNText style={tx('800', 10, t.colors.goldInk, { letterSpacing: 0.8 })}>EXAMPLE</RNText>
              </View>
              <RNText style={tx('400', 12, t.colors.muted)}>How an offer will appear</RNText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: t.colors.purpleDeep, alignItems: 'center', justifyContent: 'center' }}>
                <RNText style={tx('800', 15, '#FFFFFF')}>R</RNText>
              </View>
              <View style={{ flex: 1 }}>
                <RNText style={tx('700', 14, t.colors.ink)}>A worker near you</RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>★ 4.8 · 23 jobs done · 2.1 km away</RNText>
              </View>
              <RNText style={tx('800', 17, t.colors.accentDeep)}>
                {formatINR(Math.max(1000, Math.round((benchMinor * 0.9) / 1000) * 1000))}
              </RNText>
            </View>
            <RNText style={tx('400', 13, t.colors.text, { marginTop: 10, lineHeight: 19 })}>
              I’ve done jobs like this many times and can come by this evening. The price includes my tools; I’ll
              check with you before buying any parts.
            </RNText>
            <RNText style={tx('500', 12, t.colors.muted, { marginTop: 8 })}>
              Estimated time: 2 hours · Can deliver by tomorrow, 6 PM
            </RNText>
          </View>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        {!pickRow ? (
          <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', lineHeight: 18 })}>
            Nothing to choose yet. You will get a notification when the first offer arrives.
          </RNText>
        ) : (
        <>
        <Pressy
          onPress={handleLock}
          scaleTo={0.96}
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
          <RNText style={tx('700', 16, t.colors.onAccent)}>Choose offer · {formatINR(pickRow.priceMinor)}</RNText>
        </Pressy>
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10, lineHeight: 18 })}>
          Names and phone numbers are shared once the work starts.
        </RNText>
        </>
        )}
      </View>
      <AddFundsSheet
        visible={shortBy !== null}
        initialMinor={shortBy ?? undefined}
        reason={
          shortBy !== null && pickRow
            ? `Your wallet is ${formatINR(shortBy)} short for ${pickRow.who}’s offer. Add at least that much, and the offer is chosen as soon as the money arrives.`
            : undefined
        }
        onClose={() => setShortBy(null)}
        flash={flash}
        onFunded={() => {
          setShortBy(null);
          void handleLock();
        }}
      />
    </Screen>
  );
}
