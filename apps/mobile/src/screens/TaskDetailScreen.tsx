import { useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { Screen, Card, Button, formatINR } from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  placeBid,
  canQuoteOn,
  getTaskDetail,
  getPosterStats,
  getProfile,
  getTask,
  type Profile,
  type Task,
} from '../data/api';
import { distanceKm, formatDistance } from '@taskdrop/rules';
import { ShareSheet, useShare } from '../components/ShareSheet';
import { taskUrl } from '../lib/links';
import { type Theme } from '../theme';
import type { FeedRow } from './HomeScreen';
import { FadeIn, tx } from '../components/primitives';
import { TaskMediaThumb } from '../components/TaskMediaThumb';
import { PersonSheet } from '../components/PersonSheet';
import { BidSheet } from '../components/BidSheet';

/**
 * Task detail — pixel parity with docs/design/_design_markup.html lines
 * 706-751 (back/share row, identity row, tag, title, body, media pair,
 * price/complete-by row, detail rows, masked-contacts note). The bottom
 * ±₹ quote stepper is kept from the previous implementation per brief —
 * the markup's own CTA here just opens a separate quote sheet that isn't
 * part of this app's navigation graph, so the existing inline stepper
 * (docs/design/_design_source.jsx lines 436-454 behaviour) stays as the
 * single place a quote/offer gets composed.
 */

type Detail = {
  id?: string;
  who: string;
  rating: string;
  whoMeta: string;
  tag: 'SERVICES' | 'PRODUCTS' | 'LOCAL HELP';
  title: string;
  body: string;
  amountMinor: number;
  by: string | null;
  hasMedia: boolean;
  glyph: '▶' | '▤' | '';
  mediaPath: string | null;
  mediaKind: 'image' | 'video' | null;
  mediaSeconds: number | null;
  dur: string | null;
};

// Fallbacks mirror _design_source.jsx `fallbackDetail` (converted to paise).
const FALLBACK_WORKER: Detail = {
  who: 'Poster 9014',
  rating: '4.8',
  whoMeta: '31 requests posted · 3.2 km away',
  tag: 'PRODUCTS',
  title: 'Vintage 35mm film camera',
  body: 'Working SLR, clean viewfinder, tested shutter. Pentax or Olympus preferred, lens included.',
  amountMinor: 450000,
  by: '9 Sep, 6 PM',
  hasMedia: false,
  mediaPath: null,
  mediaKind: null,
  mediaSeconds: null,
  glyph: '▶',
  dur: '0:34',
};

const FALLBACK_POSTER: Detail = {
  who: 'Tasker 3315',
  rating: '4.9',
  whoMeta: '61 jobs done · 4 km away',
  tag: 'SERVICES',
  title: 'Bespoke carpentry and joinery',
  body: 'Ten years of joinery. Wardrobes, shelving, alcove units, on-site fitting included.',
  amountMinor: 120000,
  by: null,
  hasMedia: false,
  mediaPath: null,
  mediaKind: null,
  mediaSeconds: null,
  glyph: '▤',
  dur: null,
};

const QUOTE_STEP_MINOR = 5000; // ₹50

function tagInk(t: Theme, tag: Detail['tag']): string {
  if (tag === 'SERVICES') return t.colors.accentDeep;
  if (tag === 'PRODUCTS') return t.colors.purple;
  return t.colors.blue;
}

function isFeedRow(v: unknown): v is FeedRow {
  return !!v && typeof v === 'object' && 'title' in v && 'amountMinor' in v;
}

export function TaskDetailScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const { mode } = useMode();
  const { flash, celebrate } = useApp();
  const { userId } = useAuth();
  const [busy, setBusy] = useState(false);
  const worker = mode === 'worker';

  const detail: Detail = useMemo(() => {
    const row = params.row;
    if (isFeedRow(row)) {
      return {
        id: row.id,
        who: row.who,
        rating: row.rating,
        whoMeta: row.whoMeta,
        tag: row.tag,
        title: row.title,
        body: row.body,
        amountMinor: row.amountMinor,
        by: row.by,
        hasMedia: row.hasMedia,
        glyph: row.glyph,
        mediaPath: row.mediaPath,
        mediaKind: row.mediaKind,
        mediaSeconds: row.mediaSeconds,
        dur: row.dur,
      };
    }
    return worker ? FALLBACK_WORKER : FALLBACK_POSTER;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.row]);

  const [quote, setQuote] = useState(detail.amountMinor);

  // Only a real row has a uuid; sample rows keep the design copy.
  const realId = detail.id && /^[0-9a-f-]{36}$/i.test(detail.id) ? detail.id : null;

  const share = useShare(flash);
  const [me, setMe] = useState<Profile | null>(null);
  const [showPerson, setShowPerson] = useState(false);
  const [otherId, setOtherId] = useState<string | null>(null);
  const [other, setOther] = useState<{
    name: string;
    record: string;
    rating: number;
    ratingCount: number;
    locLabel: string | null;
    locLat: number | null;
    locLng: number | null;
  } | null>(null);
  // The task as the database has it. The feed row is a summary — it carries no
  // description and, until now, the fetched task was used only for the poster
  // and then discarded, so a worker deciding whether to quote could see neither
  // the description nor the photo.
  // Why this person cannot quote here, asked before the button is drawn.
  // Only ever "the task closed" or "you already quoted" — a worker looking at
  // his own request is redirected to the poster side instead of refused.
  const [blocked, setBlocked] = useState<string | null>(null);
  const [live, setLive] = useState<{
    body: string;
    mediaPath: string | null;
    mediaKind: 'image' | 'video' | null;
    mediaSeconds: number | null;
  } | null>(null);

  useEffect(() => {
    if (!realId || !userId) return;
    let alive = true;
    void (async () => {
      try {
        const [mine, td] = await Promise.all([getProfile(userId), getTaskDetail(realId)]);
        if (!alive) return;
        setMe(mine);
        if (td?.task) {
          const kind = td.task.media_kind;
          setLive({
            body: td.task.description ?? '',
            mediaPath: td.task.media_path ?? null,
            mediaKind: kind === 'image' || kind === 'video' ? kind : null,
            mediaSeconds: td.task.media_seconds ?? null,
          });
        }
        if (worker) {
          const verdict = await canQuoteOn(realId, userId);
          if (!alive) return;
          if (!verdict.allowed && verdict.code === 'own') {
            // Not a refusal — the wrong screen. Your own request has a poster
            // side, and what you want there is the quotes it has received.
            go('compare', {
              title: td?.task.title ?? '',
              priceMinor: td?.task.benchmark_minor ?? 0,
              taskId: realId,
            });
            return;
          }
          setBlocked(verdict.allowed ? null : verdict.reason);
        }
        const posterId = td?.task.poster_id;
        if (!posterId) return;
        setOtherId(posterId);
        const stats = await getPosterStats(posterId);
        if (!alive) return;
        const n = stats.requestsPosted;
        setOther({
          name: stats.profile?.display_name ?? 'Poster',
          record: n + (n === 1 ? ' request posted' : ' requests posted'),
          rating: Number(stats.profile?.poster_rating_avg ?? 0),
          ratingCount: stats.profile?.poster_rating_count ?? 0,
          locLabel: stats.profile?.loc_label ?? null,
          locLat: stats.profile?.loc_lat ?? null,
          locLng: stats.profile?.loc_lng ?? null,
        });
      } catch {
        /* leave the design copy in place */
      }
    })();
    return () => {
      alive = false;
    };
  }, [realId, userId, worker, go]);

  const body = live?.body || detail.body;
  const mediaPath = live ? live.mediaPath : detail.mediaPath;
  const mediaKind = live ? live.mediaKind : detail.mediaKind;
  const mediaSeconds = live ? live.mediaSeconds : detail.mediaSeconds;

  const priceLabel = worker ? 'THEIR QUOTE' : 'THEIR RATE';
  const delta = quote - detail.amountMinor;
  const deltaText =
    delta === 0 ? 'same as asked' : delta > 0 ? `+${formatINR(delta)} above` : `−${formatINR(-delta)} below`;
  const deltaColor = delta === 0 ? t.colors.muted : delta > 0 ? t.colors.gold : t.colors.accent;

  // The design's sample rows carry their record inside a display string; a real
  // task has a real poster behind it, so use them rather than parsing that.
  const whoMetaParts = detail.whoMeta.split(' · ');
  const sampleRecord = whoMetaParts[0] ?? null;
  const sampleDistance = whoMetaParts[1] ?? null;

  const recordLabel = worker ? 'Requests posted' : 'Jobs completed';
  const recordValue = other
    ? other.ratingCount > 0
      ? other.record + ' · ★ ' + other.rating.toFixed(1)
      : other.record + ' · no reviews yet'
    : (sampleRecord ?? 'New here');

  // Never claim "nearby" when neither side has shared a location.
  const distanceValue =
    formatDistance(
      distanceKm(
        { lat: me?.loc_lat ?? null, lng: me?.loc_lng ?? null },
        { lat: other?.locLat ?? null, lng: other?.locLng ?? null },
      ),
    ) ??
    other?.locLabel ??
    sampleDistance ??
    'Not shared';

  // Identity in the header comes from the same loaded profile as the rows
  // below, so the two can never disagree.
  const displayName = other?.name ?? detail.who;
  const ratingText = other
    ? other.ratingCount > 0
      ? '★ ' + other.rating.toFixed(1)
      : null
    : detail.rating && detail.rating !== '—'
      ? '★ ' + detail.rating
      : null;
  const displayMeta = other?.locLabel ?? detail.whoMeta;
  const detailRows = [
    { label: recordLabel, value: recordValue },
    { label: 'Distance', value: distanceValue },
  ];

  const cta = worker ? 'Send a quote' : 'Send my quote';

  // The detailed bid: a proposal, hours and a delivery date on top of the
  // price. Same placeBid underneath, so the same checks apply.
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const openBid = async () => {
    if (!realId) return flash('This is a sample task — post a real one to quote on it');
    const task = await getTask(realId).catch(() => null);
    if (!task) return flash('This task is no longer available');
    setBidTask(task);
  };


  const sendQuote = async () => {
    if (busy) return;
    if (worker) {
      if (!realId) return flash('This is a sample task — post a real one to quote on it');
      if (!userId) return flash('Sign in to send a quote');
      setBusy(true);
      try {
        await placeBid({
          taskId: realId,
          workerId: userId,
          priceMinor: quote,
          timeLimitMinutes: 240,
        });
        celebrate('Quote sent · ' + formatINR(quote));
        go('orders');
      } catch (e) {
        // placeBid already turns a policy refusal into a sentence. Whatever it
        // is, it also means the quote box should not still be offered.
        const msg = e instanceof Error ? e.message : 'Could not send the quote';
        setBlocked(msg);
        flash(msg);
      } finally {
        setBusy(false);
      }
      return;
    }
    go('escrow', { priceMinor: quote, title: detail.title, taskId: realId });
  };

  return (
    <Screen scroll padded={false}>
      <FadeIn style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={back} hitSlop={8}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <Pressable
            onPress={() =>
              share.start(
                realId && taskUrl(realId)
                  ? {
                      title: detail.title,
                      message: `${detail.title} · ${formatINR(detail.amountMinor)} on TaskDrop`,
                      url: taskUrl(realId)!,
                    }
                  : null,
              )
            }
            hitSlop={8}
          >
            <RNText style={tx('400', 18, t.colors.ink)}>↗</RNText>
          </Pressable>
        </View>

        <Pressable
          onPress={() => setShowPerson(true)}
          accessibilityRole="button"
          accessibilityLabel={`About ${displayName}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 13,
            marginTop: 16,
            paddingBottom: 15,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          }}
        >
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
              <RNText style={tx('700', 15, t.colors.ink)}>{displayName}</RNText>
              {ratingText ? (
                <RNText style={tx('400', 12, t.colors.muted)}>{ratingText}</RNText>
              ) : null}
            </View>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>{displayMeta}</RNText>
          </View>
          <RNText style={tx('400', 16, t.colors.muted)}>›</RNText>
        </Pressable>

        <RNText style={tx('700', 10, tagInk(t, detail.tag), { letterSpacing: 1.6, marginTop: 16 })}>
          {detail.tag}
        </RNText>
        <RNText style={tx('800', 23, t.colors.ink, { letterSpacing: -0.69, marginTop: 9 })}>{detail.title}</RNText>
        {body ? (
          <RNText style={tx('400', 14, t.colors.text, { lineHeight: 21.7, marginTop: 11 })}>
            {body}
          </RNText>
        ) : null}

        {/* One attachment, shown properly. This used to be two grey squares
            with a glyph in them — a picture of a photo, not the photo. */}
        {mediaPath && (
          <View style={{ marginTop: 16, height: 210 }}>
            <TaskMediaThumb path={mediaPath} kind={mediaKind} seconds={mediaSeconds} radius={14} />
          </View>
        )}

        <View
          style={{
            flexDirection: 'row',
            marginTop: 18,
            borderTopWidth: 1,
            borderTopColor: t.colors.line,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          }}
        >
          <View style={{ flex: 1, paddingVertical: 14 }}>
            <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>{priceLabel}</RNText>
            <RNText style={tx('800', 20, t.colors.accentDeep, { marginTop: 4 })}>{formatINR(detail.amountMinor)}</RNText>
          </View>
          {/* Only shown when there is a real deadline. A worker's service listing
              has none — the poster sets it when engaging — so the column is
              omitted rather than showing a placeholder. */}
          {detail.by ? (
            <View style={{ flex: 1, paddingVertical: 14 }}>
              <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>COMPLETE BY</RNText>
              <RNText style={tx('700', 20, t.colors.ink, { marginTop: 4 })}>{detail.by}</RNText>
            </View>
          ) : null}
        </View>

        {detailRows.map((r) => (
          <View
            key={r.label}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.line,
            }}
          >
            <RNText style={tx('400', 14, t.colors.muted)}>{r.label}</RNText>
            <RNText style={tx('700', 14, t.colors.ink)}>{r.value}</RNText>
          </View>
        ))}

        <RNText style={tx('400', 12, t.colors.muted, { lineHeight: 18, marginTop: 13 })}>
          Contacts stay masked until the task starts.
        </RNText>

        {worker && blocked ? (
          /* Say why instead of showing a price box that cannot be sent. The
             three reasons — own request, closed, already quoted — each leave
             the person somewhere different to go next. */
          <Card style={{ marginTop: t.spacing.xl, marginBottom: t.spacing.xl }}>
            <RNText style={tx('600', 13, t.colors.muted, { marginBottom: 8 })}>
              {/already quoted/i.test(blocked) ? 'QUOTE SENT' : 'CLOSED FOR QUOTES'}
            </RNText>
            <RNText style={tx('600', 15, t.colors.ink, { lineHeight: 22 })}>{blocked}</RNText>
            <Button
              label={/already quoted/i.test(blocked) ? 'Edit my quote' : 'Find another request'}
              onPress={() => (/already quoted/i.test(blocked) ? void openBid() : go('explore'))}
              style={{ marginTop: t.spacing.lg }}
            />
          </Card>
        ) : (
        <Card style={{ marginTop: t.spacing.xl, marginBottom: t.spacing.xl }}>
          <RNText style={tx('600', 13, t.colors.muted, { marginBottom: 10 })}>
            {worker ? 'YOUR QUOTE' : 'YOUR OFFER'}
          </RNText>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pressable
              onPress={() => setQuote((q) => Math.max(QUOTE_STEP_MINOR, q - QUOTE_STEP_MINOR))}
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                backgroundColor: t.colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx('700', 16, t.colors.ink)}>−</RNText>
            </Pressable>

            <View style={{ flex: 1, alignItems: 'center' }}>
              <AmountField
                rupees={Math.round(quote / 100)}
                onChangeRupees={(r) => setQuote((r ?? 0) * 100)}
                min={1}
                style={tx('800', 30, t.colors.ink, { letterSpacing: -0.5 })}
              />
              <RNText style={tx('500', 12, deltaColor, { marginTop: 2 })}>{deltaText}</RNText>
            </View>

            <Pressable
              onPress={() => setQuote((q) => q + QUOTE_STEP_MINOR)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                backgroundColor: t.colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx('700', 16, t.colors.ink)}>+</RNText>
            </Pressable>
          </View>

          <Button
            label={busy ? 'Sending…' : cta}
            disabled={busy}
            onPress={sendQuote}
            style={{ marginTop: t.spacing.lg }}
          />
          <RNText style={tx('500', 12, t.colors.muted, { marginTop: 10, textAlign: 'center' })}>
            {worker
              ? 'One quote per task. Contacts stay masked until the task starts.'
              : 'Your quote goes to this worker. They can lock it and start.'}
          </RNText>
          {worker && realId ? (
            <Pressable onPress={() => void openBid()} style={{ alignSelf: 'center', marginTop: 12 }} accessibilityRole="button">
              <RNText style={tx('700', 13, t.colors.purpleDeep)}>Or send a detailed bid with a proposal ›</RNText>
            </Pressable>
          ) : null}
        </Card>
        )}
      </FadeIn>
      <BidSheet
        task={bidTask}
        visible={bidTask !== null}
        onClose={() => setBidTask(null)}
        onPlaced={() => go('myTasks')}
      />
      <ShareSheet visible={share.open} item={share.item} onClose={share.close} flash={flash} />

      <PersonSheet
        visible={showPerson}
        onClose={() => setShowPerson(false)}
        userId={otherId}
        name={displayName}
        meta={[other?.record, displayMeta].filter(Boolean).join(' · ') || displayMeta}
        rating={other?.rating ?? 0}
        ratingCount={other?.ratingCount ?? 0}
        // A worker is looking at whoever posted the task, and vice versa.
        role={worker ? 'poster' : 'worker'}
      />
    </Screen>
  );
}
