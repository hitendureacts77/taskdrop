import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import { HeroCard } from './Hero';
import { useMinute } from './HuntTag';
import { Icon } from './Icon';
import { BottomSheet, ConfirmDialog, PrimaryButton, rupees, timeAgo } from './kit';
import { FadeIn, Pressy, tx } from './primitives';
import { cardSurface, formatINR } from './ui';
import { TaskMediaThumb } from './TaskMediaThumb';
import { AddFundsSheet } from './AddFundsSheet';
import { ExplainerSheet } from './ExplainerSheet';
import {
  WalletShortError, huntAcceptFind, huntAskPart, huntCounts, huntDeclineFind, huntFinds, huntLook, huntSendFind,
  type HuntCounts, type HuntFind, type Task,
} from '../data/api';
import {
  HUNT_DECLINE_REASONS, HUNT_NEEDS, MAX_FINDS_PER_HUNT, findAction, findDistanceText, huntPhase, huntTimeLeft,
  pinLink, proofChecks, visibleFind, type HuntDeclineReason, type HuntNeed,
} from '../lib/hunt';
import { takePhoto } from '../lib/takePhoto';
import { uploadMedia, type PickedMedia } from '../lib/media';
import { resolveCurrentPlace } from '../lib/location';
import { useFees } from '../lib/useFees';
import { isNeedsAccount, needAccount } from '../lib/guest';
import { reportError } from '../lib/errors';
import { HUNT_LINK } from '../lib/explainers';

/**
 * City Hunt (design D19): the Hunt's pieces. The gold tag on Earn cards, the
 * gold hero on the task page, the poster's finds list (C3) and the finder's
 * "Send a find" sheet (C4). What is shown before a find is accepted is exactly
 * what the server sends; the screens never hold a locked photo, place or pin.
 */

type HuntTask = Pick<Task, 'id' | 'title' | 'benchmark_minor' | 'status' | 'loc_lat'> & {
  hunt_until: string | null;
  hunt_needs: string[] | null;
};

/** The Hunt's counts, and a way to ask again. Quiet: no counts is not an error. */
export function useHuntCounts(taskId: string | null, signedIn: boolean): [HuntCounts | null, () => void] {
  const [c, setC] = useState<HuntCounts | null>(null);
  const load = useCallback(() => {
    if (!taskId || !signedIn) return;
    void huntCounts([taskId]).then((r) => setC(r[0] ?? null));
  }, [taskId, signedIn]);
  useEffect(load, [load]);
  return [c, load];
}

/** The small "How a Hunt works" link under a Hunt's text: opens the explainer sheet again. */
export function HuntHelpLink({ onPress, marginTop = 10 }: { onPress: () => void; marginTop?: number }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={HUNT_LINK}
      style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop, paddingVertical: 4 }}
    >
      <Icon name="help" size={15} color={t.colors.goldInk} />
      <RNText style={tx('700', 12.5, t.colors.goldInk)}>{HUNT_LINK}</RNText>
    </Pressable>
  );
}

// --------------------------------------------------------------- the hero --

function HuntHero({ task, counts, now }: { task: HuntTask; counts: HuntCounts | null; now: number }) {
  const phase = huntPhase(task, now);
  const left = phase === 'live' ? huntTimeLeft(task.hunt_until, now) : phase === 'reviewing' ? 'Stopped taking finds' : 'Ended';
  return (
    <HeroCard tone="hunt" radius={22} padding={18} watermark={false} ringSize={180}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
          <RNText style={tx('800', 11, '#FFFFFF', { letterSpacing: 1.2 })}>HUNT · {rupees(task.benchmark_minor / 100)}</RNText>
        </View>
        <RNText style={tx('700', 12, 'rgba(255,255,255,0.9)')}>{left}</RNText>
      </View>
      <RNText style={tx('800', 21, '#FFFFFF', { letterSpacing: -0.5, lineHeight: 26, marginTop: 10 })}>{task.title}</RNText>
      <View style={{ flexDirection: 'row', gap: 18, marginTop: 14 }}>
        <View>
          <RNText style={tx('800', 24, '#FFFFFF', { fontVariant: ['tabular-nums'] })}>{counts?.lookers ?? 0}</RNText>
          <RNText style={tx('500', 11.5, 'rgba(255,255,255,0.85)')}>
            {(counts?.lookers ?? 0) === 1 ? 'person looking' : 'people looking'}
          </RNText>
        </View>
        <View>
          <RNText style={tx('800', 24, '#FFFFFF', { fontVariant: ['tabular-nums'] })}>{counts?.finds ?? 0}</RNText>
          <RNText style={tx('500', 11.5, 'rgba(255,255,255,0.85)')}>{(counts?.finds ?? 0) === 1 ? 'find sent' : 'finds sent'}</RNText>
        </View>
      </View>
    </HeroCard>
  );
}

/** A locked find's picture: a soft gradient and a lock, never the real image. */
function LockedTile({ size = 84 }: { size?: number }) {
  const t = useTheme();
  const [id] = useState(() => `huntLock${Math.random().toString(36).slice(2, 8)}`);
  return (
    <View style={{ width: size, height: size, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.colors.accentSoft} />
            <Stop offset="0.5" stopColor={t.colors.goldSoft} />
            <Stop offset="1" stopColor={t.colors.surface2} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={size} height={size} fill={`url(#${id})`} />
      </Svg>
      <Icon name="lock" size={22} color={t.colors.goldInk} strokeWidth={2} />
    </View>
  );
}

function Checks({ find, needs }: { find: HuntFind; needs: readonly string[] | null }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 2, marginTop: 6 }}>
      {proofChecks(find, needs).map((c) => (
        <RNText key={c.label} style={tx('700', 11.5, c.ok ? t.colors.accentDeep : t.colors.muted)}>
          {c.ok ? '✓' : '✕'} {c.label}
        </RNText>
      ))}
    </View>
  );
}

/** What an accepted (or your own) find shows: the photo, the place, the pin, the price, the note. */
function Unlocked({ find }: { find: HuntFind }) {
  const t = useTheme();
  const f = visibleFind(find);
  return (
    <View style={{ marginTop: 10, gap: 6 }}>
      {f.place_name ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="home" size={14} color={t.colors.muted} />
          <RNText style={tx('700', 13, t.colors.ink, { flex: 1 })}>{f.place_name}</RNText>
        </View>
      ) : null}
      {f.lat != null && f.lng != null ? (
        <Pressable
          onPress={() => void Linking.openURL(pinLink(f.lat!, f.lng!))}
          accessibilityRole="link"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Icon name="pin" size={14} color={t.colors.accentDeep} />
          <RNText style={tx('700', 13, t.colors.accentDeep)}>Open the pin in maps</RNText>
        </Pressable>
      ) : null}
      {f.price_note ? <RNText style={tx('600', 13, t.colors.text)}>Price: {f.price_note}</RNText> : null}
      {f.note ? <RNText style={tx('400', 13, t.colors.text, { lineHeight: 19 })}>“{f.note}”</RNText> : null}
    </View>
  );
}

// ------------------------------------------------- the poster's task page --

/**
 * C3: the Hunt's hero, the unlock note and the finds. Accepting pays the finder
 * from the wallet (a short wallet opens the same top-up as choosing an offer).
 */
export function HuntPosterPanel({ task, onChanged }: { task: HuntTask; onChanged: () => void }) {
  const t = useTheme();
  const fees = useFees();
  const { flash, celebrate } = useActions();
  const now = useMinute();
  const [counts, reloadCounts] = useHuntCounts(task.id, true);
  const [finds, setFinds] = useState<HuntFind[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<HuntFind | null>(null);
  const [declining, setDeclining] = useState<HuntFind | null>(null);
  const [help, setHelp] = useState(false);
  const [shortBy, setShortBy] = useState<{ minor: number; find: HuntFind } | null>(null);
  const phase = huntPhase(task, now);
  const reward = rupees(task.benchmark_minor / 100);

  const load = useCallback(async () => {
    try {
      setFinds(await huntFinds(task.id));
    } catch (e) {
      reportError(e, 'hunt-finds');
      setFinds((f) => f ?? []);
    }
    reloadCounts();
  }, [task.id, reloadCounts]);
  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (find: HuntFind) => {
    if (busy) return;
    setBusy(find.id);
    try {
      await huntAcceptFind(find.id);
      setAccepting(null);
      celebrate(`Found it · ${find.finder_name ?? 'the finder'} is paid`);
      await load();
      onChanged();
    } catch (e) {
      if (e instanceof WalletShortError) {
        setAccepting(null);
        setShortBy({ minor: e.shortMinor, find });
      } else {
        flash(e instanceof Error ? e.message : 'Could not accept that find');
      }
    } finally {
      setBusy(null);
    }
  };

  const decline = async (find: HuntFind, reason: HuntDeclineReason) => {
    setBusy(find.id);
    try {
      await huntDeclineFind(find.id, reason);
      setDeclining(null);
      flash('Done. We told the finder.');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not answer that find');
    } finally {
      setBusy(null);
    }
  };

  const ask = async (find: HuntFind, part: HuntNeed) => {
    setBusy(find.id);
    try {
      await huntAskPart(find.id, part);
      flash('Asked. They will get a notification.');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not ask the finder');
    } finally {
      setBusy(null);
    }
  };

  const shown = (finds ?? []).filter((f) => f.status !== 'declined');
  const declined = (finds ?? []).length - shown.length;
  const canAnswer = phase === 'live' || phase === 'reviewing';
  const card = { ...cardSurface(t, 18), padding: 12, marginTop: 10 } as const;

  return (
    <View>
      <HuntHero task={task} counts={counts} now={now} />

      <View
        style={{
          flexDirection: 'row',
          gap: 10,
          alignItems: 'flex-start',
          marginTop: 14,
          padding: 12,
          borderRadius: 14,
          backgroundColor: t.colors.accentSoft,
        }}
      >
        <Icon name="lock" size={16} color={t.colors.accentDeep} strokeWidth={2.2} />
        <RNText style={tx('600', 12.5, t.colors.accentDeep, { flex: 1, lineHeight: 18 })}>
          The photo, the shop’s name and the pin unlock when you tap This is it. That pays the finder.
        </RNText>
      </View>
      <HuntHelpLink onPress={() => setHelp(true)} />
      <ExplainerSheet which="hunt" visible={help} onClose={() => setHelp(false)} />

      {phase === 'reviewing' ? (
        <RNText style={tx('500', 12.5, t.colors.muted, { marginTop: 10, lineHeight: 18 })}>
          This Hunt stopped taking finds. You can still accept one for a day.
        </RNText>
      ) : null}
      {phase === 'ended' && task.status === 'OPEN' ? (
        <RNText style={tx('500', 12.5, t.colors.muted, { marginTop: 10, lineHeight: 18 })}>
          This Hunt has ended. Nothing was found, so nothing was paid.
        </RNText>
      ) : null}

      {finds === null ? null : shown.length === 0 ? (
        <View style={[card, { alignItems: 'center', paddingVertical: 22 }]}>
          <RNText style={tx('700', 14, t.colors.ink)}>No finds yet</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, textAlign: 'center' })}>
            People nearby can see your Hunt. You will get a notification when a find comes in.
          </RNText>
        </View>
      ) : (
        shown.map((f, i) => {
          const action = findAction(f, task.hunt_needs, reward);
          const dist = findDistanceText(f.distance_km);
          const rating = f.finder_rating_count && f.finder_rating_count > 0 ? ` · ★ ${Number(f.finder_rating).toFixed(1)}` : '';
          return (
            <FadeIn key={f.id} duration={300} delay={Math.min(i, 6) * 50}>
              <View style={[card, { flexDirection: 'row', gap: 12 }]}>
                {f.unlocked && f.photo_path ? (
                  <TaskMediaThumb path={f.photo_path} kind="image" size={84} radius={14} />
                ) : (
                  <LockedTile />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <RNText style={tx('800', 14.5, t.colors.ink)}>
                    Find {i + 1}
                    {dist ? ` · ${dist}` : ''}
                  </RNText>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                    Sent {timeAgo(f.created_at)} by {f.finder_name ?? 'a finder'}
                    {rating}
                  </RNText>
                  <Checks find={f} needs={task.hunt_needs} />
                  {f.status === 'accepted' ? (
                    <>
                      <RNText style={tx('800', 12, t.colors.accentDeep, { marginTop: 8 })}>THIS IS IT · PAID</RNText>
                      <Unlocked find={f} />
                    </>
                  ) : f.status === 'closed' ? (
                    <RNText style={tx('600', 12, t.colors.muted, { marginTop: 8 })}>Closed: another find was the one</RNText>
                  ) : canAnswer ? (
                    <>
                      {f.asked_part ? (
                        <RNText style={tx('600', 11.5, t.colors.goldInk, { marginTop: 6 })}>
                          You asked for the {HUNT_NEEDS.find((n) => n.key === f.asked_part)?.missing ?? 'detail'}
                        </RNText>
                      ) : null}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <Pressable
                          onPress={() => setDeclining(f)}
                          disabled={busy !== null}
                          accessibilityRole="button"
                          style={{
                            height: 38,
                            paddingHorizontal: 14,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: t.colors.line,
                            justifyContent: 'center',
                          }}
                        >
                          <RNText style={tx('700', 13.5, t.colors.ink)}>Not it</RNText>
                        </Pressable>
                        <Pressy
                          onPress={() => (action.kind === 'ask' ? void ask(f, action.part) : setAccepting(f))}
                          disabled={busy !== null}
                          label={action.label}
                          style={{
                            flex: 1,
                            height: 38,
                            borderRadius: 12,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: action.kind === 'ask' ? t.colors.goldSoft : t.colors.gold,
                          }}
                        >
                          <RNText style={tx('800', 13.5, action.kind === 'ask' ? t.colors.goldInk : t.colors.ink)} numberOfLines={1}>
                            {busy === f.id ? 'One moment…' : action.label}
                          </RNText>
                        </Pressy>
                      </View>
                    </>
                  ) : null}
                </View>
              </View>
            </FadeIn>
          );
        })
      )}
      {declined > 0 ? (
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10 })}>
          {declined === 1 ? 'One find you said Not it to is hidden.' : `${declined} finds you said Not it to are hidden.`}
        </RNText>
      ) : null}

      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 16, lineHeight: 18, textAlign: 'center' })}>
        You pay only when you tap This is it. Nothing found, nothing paid.
      </RNText>

      <ConfirmDialog
        visible={accepting !== null}
        icon="check"
        title={`This is it? Pay ${reward}`}
        message={`${formatINR(Math.round(task.benchmark_minor * (1 + fees.posterFee)))} (the reward plus the ${Math.round(fees.posterFee * 100)}% service fee) is taken from your wallet and the finder is paid. The photo, the place and the pin unlock for you. The other finds are closed.`}
        confirmLabel="Yes, pay from wallet"
        busy={busy !== null}
        onCancel={() => setAccepting(null)}
        onConfirm={() => accepting && void accept(accepting)}
      />
      <BottomSheet visible={declining !== null} onClose={() => setDeclining(null)} title="Not it" subtitle="Tell the finder why. Their find stays hidden.">
        <View style={{ gap: 8 }}>
          {HUNT_DECLINE_REASONS.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => declining && void decline(declining, r.key)}
              disabled={busy !== null}
              accessibilityRole="button"
              style={({ pressed }) => ({
                padding: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: t.colors.line,
                backgroundColor: pressed ? t.colors.surface2 : t.colors.surface,
              })}
            >
              <RNText style={tx('700', 14, t.colors.ink)}>{r.label}</RNText>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
      <AddFundsSheet
        visible={shortBy !== null}
        initialMinor={shortBy?.minor}
        reason={shortBy ? `Your wallet is ${formatINR(shortBy.minor)} short to pay this find. Add at least that much, and the find is accepted as soon as the money arrives.` : undefined}
        onClose={() => setShortBy(null)}
        flash={flash}
        onFunded={() => {
          const find = shortBy?.find;
          setShortBy(null);
          if (find) void accept(find);
        }}
      />
    </View>
  );
}

// ------------------------------------------------------ the finder's side --

/**
 * The Hunt on a finder's task page: the hero, "I'm looking", "Send a find" and
 * their own finds with what happened to each. Guests see it read-only; a tap
 * opens the "Make your account" pop-up.
 */
export function HuntFinderPanel({ task }: { task: HuntTask }) {
  const t = useTheme();
  const { userId, guest } = useAuth();
  const { flash } = useActions();
  const now = useMinute();
  const [counts, reloadCounts] = useHuntCounts(task.id, Boolean(userId));
  const [mine, setMine] = useState<HuntFind[]>([]);
  const [sheet, setSheet] = useState(false);
  const [looking, setLooking] = useState(false);
  const [help, setHelp] = useState(false);
  const phase = huntPhase(task, now);
  const live = phase === 'live';

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setMine((await huntFinds(task.id)).filter((f) => f.mine));
    } catch {
      /* no finds yet is the usual answer */
    }
    reloadCounts();
  }, [task.id, userId, reloadCounts]);
  useEffect(() => {
    void load();
  }, [load]);

  const look = async () => {
    if (guest || !userId) return needAccount('offer', () => void look());
    setLooking(true);
    try {
      await huntLook(task.id);
      flash('You are looking. Send a find when you have it.');
      reloadCounts();
    } catch (e) {
      if (!isNeedsAccount(e)) flash(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setLooking(false);
    }
  };

  const openSheet = () => {
    if (guest || !userId) return needAccount('offer', () => setSheet(true));
    setSheet(true);
  };

  const left = MAX_FINDS_PER_HUNT - mine.length;
  const isLooking = counts?.looking ?? false;

  return (
    <View>
      <HuntHero task={task} counts={counts} now={now} />
      <RNText style={tx('500', 12.5, t.colors.muted, { marginTop: 12, lineHeight: 18 })}>
        {live
          ? `Find it, take a photo there and send it. If yours is the one the customer accepts, you get ${rupees(task.benchmark_minor / 100)}. Only the find that is accepted is paid.`
          : 'This Hunt is not taking finds any more.'}
      </RNText>
      <HuntHelpLink onPress={() => setHelp(true)} marginTop={6} />
      <ExplainerSheet which="huntFinder" visible={help} onClose={() => setHelp(false)} />

      {live ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          {!isLooking ? (
            <Pressable
              onPress={() => void look()}
              disabled={looking}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flex: 1,
                height: 50,
                borderRadius: 16,
                borderWidth: 1.5,
                borderColor: t.colors.accentBorder,
                backgroundColor: t.colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <RNText style={tx('800', 14, t.colors.accentDeep)}>{looking ? 'One moment…' : 'I’m looking'}</RNText>
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={left > 0 ? 'Send a find' : 'You sent 3 finds'}
              onPress={openSheet}
              disabled={left <= 0}
            />
          </View>
        </View>
      ) : null}

      {mine.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>YOUR FINDS</RNText>
          {mine.map((f) => (
            <View key={f.id} style={{ ...cardSurface(t, 16), padding: 12, marginTop: 8, flexDirection: 'row', gap: 12 }}>
              {f.photo_path ? <TaskMediaThumb path={f.photo_path} kind="image" size={60} radius={12} /> : <LockedTile size={60} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText style={tx('700', 13.5, t.colors.ink)}>
                  {f.status === 'accepted'
                    ? 'Accepted · you are paid'
                    : f.status === 'declined'
                      ? `Not picked · ${HUNT_DECLINE_REASONS.find((r) => r.key === f.decline_reason)?.label ?? 'not the one'}`
                      : f.status === 'closed'
                        ? 'It was found. Thanks for looking.'
                        : 'Sent · waiting for the customer'}
                </RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>Sent {timeAgo(f.created_at)}</RNText>
                {f.asked_part && f.status === 'pending' ? (
                  <RNText style={tx('600', 12, t.colors.goldInk, { marginTop: 4 })}>
                    The customer asked for the {HUNT_NEEDS.find((n) => n.key === f.asked_part)?.missing ?? 'detail'}. Send a new find with it.
                  </RNText>
                ) : null}
                {f.place_name ? <RNText style={tx('500', 12, t.colors.text, { marginTop: 4 })}>{f.place_name}</RNText> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <HuntFindSheet
        visible={sheet}
        task={task}
        onClose={() => setSheet(false)}
        onSent={() => {
          setSheet(false);
          void load();
        }}
      />
    </View>
  );
}

// ------------------------------------------------------- the find sheet --

/** C4: a photo taken now (never the gallery), the place's name, a pin where the finder stands, a price, a note. */
export function HuntFindSheet({
  visible,
  task,
  onClose,
  onSent,
}: {
  visible: boolean;
  task: HuntTask;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useTheme();
  const { flash, celebrate } = useActions();
  const needs = (task.hunt_needs ?? []) as HuntNeed[];
  const atPlace = task.loc_lat !== null;
  const [photo, setPhoto] = useState<PickedMedia | null>(null);
  const [takenAt, setTakenAt] = useState<Date | null>(null);
  const [place, setPlace] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinState, setPinState] = useState<'idle' | 'finding' | 'failed'>('idle');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPhoto(null);
    setTakenAt(null);
    setPlace('');
    setPrice('');
    setNote('');
    setPin(null);
    setPinState('idle');
  }, [visible]);

  const shoot = async () => {
    try {
      const p = await takePhoto();
      if (p) {
        setPhoto(p);
        setTakenAt(new Date());
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not open the camera');
    }
  };

  const findPin = async () => {
    setPinState('finding');
    try {
      const at = await resolveCurrentPlace();
      if (at.lat == null || at.lng == null) throw new Error('No fix');
      setPin({ lat: at.lat, lng: at.lng });
      setPinState('idle');
    } catch (e) {
      setPinState('failed');
      flash(e instanceof Error ? e.message : 'Could not find where you are');
    }
  };

  const missing = needs.filter(
    (n) => (n === 'photo' && !photo) || (n === 'place' && !place.trim()) || (n === 'pin' && !pin) || (n === 'price' && !price.trim()),
  );
  const photoNeeded = needs.includes('photo') && !photo;
  const empty = !photo && !place.trim() && !pin && !price.trim();

  const send = async () => {
    if (sending || photoNeeded || empty) return;
    setSending(true);
    try {
      const stored = photo ? await uploadMedia(photo, 'proof') : null;
      await huntSendFind({
        taskId: task.id,
        photoPath: stored?.path ?? null,
        placeName: place.trim() || null,
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        priceNote: price.trim() || null,
        note: note.trim() || null,
      });
      celebrate('Find sent');
      onSent();
    } catch (e) {
      if (!isNeedsAccount(e)) flash(e instanceof Error ? e.message : 'Could not send your find');
    } finally {
      setSending(false);
    }
  };

  const field = (icon: 'home' | 'tag' | 'chat', value: string, set: (v: string) => void, placeholder: string, max: number, label: string) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: t.colors.line,
        backgroundColor: t.colors.surface,
        paddingHorizontal: 12,
        marginTop: 10,
      }}
    >
      <Icon name={icon} size={16} color={t.colors.muted} />
      <TextInput
        value={value}
        onChangeText={set}
        placeholder={placeholder}
        placeholderTextColor={t.colors.muted}
        maxLength={max}
        accessibilityLabel={label}
        style={tx('600', 14, t.colors.ink, {
          flex: 1,
          paddingVertical: 12,
          ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
        })}
      />
    </View>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Send a find" subtitle="Photo must be taken now, here. No gallery.">
      <Pressable
        onPress={() => void shoot()}
        accessibilityRole="button"
        accessibilityLabel={photo ? 'Take the photo again' : 'Take a photo now'}
        style={{
          height: 150,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: t.colors.surface2,
          borderWidth: 1,
          borderColor: t.colors.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {photo ? (
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
            <TaskMediaThumb path={photo.uri} kind="image" url={photo.uri} radius={0} />
          </View>
        ) : (
          <>
            <Icon name="camera" size={26} color={t.colors.ink} strokeWidth={1.8} />
            <RNText style={tx('700', 13, t.colors.ink, { marginTop: 6 })}>Take a photo now</RNText>
          </>
        )}
        {photo && takenAt ? (
          <View style={{ position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
            <RNText style={tx('700', 11, '#FFFFFF')}>
              Taken {takenAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · tap to retake
            </RNText>
          </View>
        ) : null}
      </Pressable>

      {field('home', place, setPlace, needs.includes('place') ? 'Shop or place name' : 'Shop or place name (optional)', 120, 'Shop or place name')}

      {atPlace || needs.includes('pin') ? (
        <Pressable
          onPress={() => void findPin()}
          accessibilityRole="button"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minHeight: 48,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: pin ? t.colors.accentBorder : t.colors.line,
            backgroundColor: pin ? t.colors.accentSoft : t.colors.surface,
            paddingHorizontal: 12,
            marginTop: 10,
          }}
        >
          <Icon name="pin" size={16} color={pin ? t.colors.accentDeep : t.colors.muted} />
          <RNText style={tx('600', 14, pin ? t.colors.accentDeep : t.colors.ink, { flex: 1 })}>
            {pin ? 'Pinned where you stand' : pinState === 'finding' ? 'Finding where you are…' : 'Pin where you stand'}
          </RNText>
        </Pressable>
      ) : null}

      {field('tag', price, setPrice, needs.includes('price') ? 'Price there, like ₹120' : 'Price (optional)', 60, 'Price')}
      {field('chat', note, setNote, 'A short note (optional)', 300, 'Note')}

      {missing.length ? (
        <RNText style={tx('500', 12, t.colors.goldInk, { marginTop: 10, lineHeight: 17 })}>
          The customer asked for: {missing.map((n) => HUNT_NEEDS.find((x) => x.key === n)!.missing).join(', ')}.
          {photoNeeded ? ' A photo is needed to send.' : ' You can still send, but they may ask for it.'}
        </RNText>
      ) : null}

      <PrimaryButton
        label={sending ? 'Sending…' : 'Send find'}
        onPress={() => void send()}
        busy={sending}
        disabled={photoNeeded || empty}
        style={{ marginTop: 14 }}
      />
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10, lineHeight: 17, textAlign: 'center' })}>
        The customer sees it locked until they accept. If yours is the one, you get {rupees(task.benchmark_minor / 100)}.
      </RNText>
    </BottomSheet>
  );
}
