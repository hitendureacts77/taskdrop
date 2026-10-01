import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { View, Text as RNText, Pressable } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useActions } from '../providers/AppStateProvider';
import { platformStats, myStats, type PlatformStats, type MyStats } from '../data/api';
import { FadeIn, Pressy, tx } from '../components/primitives';
import type { Theme } from '../theme';

/**
 * What the business is doing, for whoever runs it.
 *
 * Every figure comes from platform_stats(), which the server refuses unless the
 * caller is an admin — these numbers span every user's rows, so the check
 * cannot live here. Revenue is derived the same way the money RPCs derive it,
 * so this can never drift from what actually moved.
 */

const WINDOWS = [7, 30, 90];

/** A headline number. Not a chart — one figure does not need axes. */
function Stat({
  label,
  value,
  sub,
  tone,
  t,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'accent' | 'gold' | 'plain';
  t: Theme;
}) {
  const ink =
    tone === 'accent' ? t.colors.accentDeep : tone === 'gold' ? t.colors.gold : t.colors.ink;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 140,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderRadius: 14,
        padding: 14,
      }}
    >
      <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>{label}</RNText>
      <RNText style={tx('800', 22, ink, { marginTop: 6, letterSpacing: -0.5 })} numberOfLines={1}>
        {value}
      </RNText>
      {sub ? (
        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3 })} numberOfLines={1}>
          {sub}
        </RNText>
      ) : null}
    </View>
  );
}

/**
 * Revenue per day. One series, so one hue and no legend — the title names it.
 * Bars are anchored to the baseline with rounded tops and a 2px gap between
 * them; the axis is a single recessive rule rather than a grid, because at this
 * density gridlines would out-weigh the data.
 */
function RevenueBars({
  daily,
  t,
  onPick,
  picked,
}: {
  daily: PlatformStats['daily'];
  t: Theme;
  onPick: (i: number | null) => void;
  picked: number | null;
}) {
  const W = 300;
  const H = 92;
  const max = Math.max(1, ...daily.map((d) => d.revenue_minor));
  const gap = 2;
  const bw = Math.max(2, W / Math.max(1, daily.length) - gap);

  return (
    <View style={{ height: H + 8 }}>
      <Svg width="100%" height={H + 8} viewBox={`0 0 ${W} ${H + 8}`}>
        {daily.map((d, i) => {
          const h = (d.revenue_minor / max) * H;
          const x = i * (bw + gap);
          const on = picked === i;
          return (
            <Rect
              key={d.day}
              x={x}
              y={H - h}
              width={bw}
              height={Math.max(h, d.revenue_minor > 0 ? 2 : 0)}
              rx={2}
              fill={on ? t.colors.ink : t.colors.accent}
              opacity={picked === null || on ? 1 : 0.45}
            />
          );
        })}
        <Line x1={0} y1={H} x2={W} y2={H} stroke={t.colors.line} strokeWidth={1} />
      </Svg>

      {/* Tapping a day reveals its figure; a number on every bar would be noise.
          Overlaid rather than stacked, or it would add a hole under the chart. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          flexDirection: 'row',
        }}
      >
        {daily.map((d, i) => (
          <Pressable
            key={d.day}
            onPress={() => onPick(picked === i ? null : i)}
            accessibilityRole="button"
            accessibilityLabel={`${d.day}: ${formatINR(d.revenue_minor)} revenue, ${d.posted} posted, ${d.completed} completed`}
            style={{ flex: 1 }}
          />
        ))}
      </View>
    </View>
  );
}

export function AnalyticsScreen() {
  const t = useTheme();
  const { back } = useNav();
  const { flash } = useActions();

  const { mode } = useMode();
  const worker = mode === 'worker';
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  // Your own figures, which everyone gets. The platform-wide ones below stay
  // admin-only; before this, a poster could not see what they had spent and a
  // worker could not see what they had earned.
  const [mine, setMine] = useState<MyStats | null>(null);

  useEffect(() => {
    let alive = true;
    void myStats(worker ? 'worker' : 'poster')
      .then((m) => alive && setMine(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [worker]);

  const load = useCallback(
    async (window: number) => {
      setLoading(true);
      try {
        setStats(await platformStats(window));
        setDenied(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not load the numbers';
        if (/admin/i.test(msg)) setDenied(true);
        else flash(msg);
      } finally {
        setLoading(false);
      }
    },
    [flash],
  );

  useEffect(() => {
    setPicked(null);
    void load(days);
  }, [days, load]);



  const day = stats && picked !== null ? stats.daily[picked] : null;

  return (
    <Screen padded={false} scroll onRefresh={() => void load(days)} refreshing={loading && !!stats}>
      <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
        <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="back" size={20} color={t.colors.ink} />
        </Pressable>

        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.72, marginTop: 14 })}>
          {worker ? 'My earnings and jobs' : 'My spending and requests'}
        </RNText>

        {/* The person's own numbers, first, because they are the ones they
            came for. Platform totals are a separate thing further down. */}
        {mine ? (
          <View style={{ marginTop: 16 }}>
            <View
              style={{
                padding: 16,
                borderRadius: 14,
                backgroundColor: t.colors.accentSoft,
                borderWidth: 1,
                borderColor: t.colors.accentBorder,
              }}
            >
              <RNText style={tx('400', 11, t.colors.accentDeep, { letterSpacing: 1.4 })}>
                {mine.role === 'worker' ? 'EARNED SO FAR' : 'SPENT SO FAR'}
              </RNText>
              <RNText
                style={tx('800', 32, t.colors.ink, { letterSpacing: -1, marginTop: 5 })}
              >
                {formatINR(mine.role === 'worker' ? mine.earnedMinor : mine.spentMinor)}
              </RNText>
              <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 4, lineHeight: 18 })}>
                {mine.role === 'worker'
                  ? `${formatINR(mine.availableMinor)} ready to withdraw · ${formatINR(
                      mine.clearingMinor,
                    )} still on the way`
                  : `${formatINR(mine.escrowHeldMinor)} held safely right now`}
              </RNText>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {(mine.role === 'worker'
                ? [
                    { label: 'Offers sent', value: String(mine.quotesPlaced) },
                    { label: 'Offers won', value: String(mine.quotesWon) },
                    { label: 'Jobs in hand', value: String(mine.jobsLive) },
                    { label: 'Jobs finished', value: String(mine.jobsDone) },
                    { label: 'Withdrawn', value: formatINR(mine.withdrawnMinor) },
                    {
                      label: 'Your rating',
                      value: mine.ratingCount > 0 ? `★ ${Number(mine.rating).toFixed(1)}` : '—',
                    },
                  ]
                : [
                    { label: 'Requests posted', value: String(mine.posted) },
                    { label: 'Still open', value: String(mine.open) },
                    { label: 'Being worked on', value: String(mine.live) },
                    { label: 'Finished', value: String(mine.completed) },
                    { label: 'Offers received', value: String(mine.quotesReceived) },
                    {
                      label: 'Your rating',
                      value: mine.ratingCount > 0 ? `★ ${Number(mine.rating).toFixed(1)}` : '—',
                    },
                  ]
              ).map((cell) => (
                <View
                  key={cell.label}
                  style={{
                    flexBasis: '47%',
                    flexGrow: 1,
                    padding: 13,
                    borderRadius: 12,
                    backgroundColor: t.colors.surface,
                    borderWidth: 1,
                    borderColor: t.colors.line,
                  }}
                >
                  <RNText style={tx('400', 11, t.colors.muted)}>{cell.label}</RNText>
                  <RNText style={tx('800', 19, t.colors.ink, { marginTop: 5 })}>
                    {cell.value}
                  </RNText>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {!denied && (
          <RNText
            style={tx('800', 19, t.colors.ink, { letterSpacing: -0.4, marginTop: 30 })}
          >
            Across the whole marketplace
          </RNText>
        )}

        {denied ? (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 20, lineHeight: 20 })}>
            Marketplace-wide figures are for admins. Your own numbers are above.
          </RNText>
        ) : null}

        {!denied && (
          <>
            {/* Time range sits in one row above the figures it governs. */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              {WINDOWS.map((w) => {
                const on = w === days;
                return (
                  <Pressy
                    key={w}
                    onPress={() => setDays(w)}
                    label={`Last ${w} days`}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: on ? t.colors.accentSoft : 'transparent',
                      borderWidth: 1,
                      borderColor: on ? t.colors.accent : t.colors.line,
                    }}
                  >
                    <RNText style={tx('600', 12, on ? t.colors.ink : t.colors.muted)}>
                      {w}d
                    </RNText>
                  </Pressy>
                );
              })}
            </View>

            {loading && !stats ? (
              <RNText style={tx('400', 14, t.colors.muted, { marginTop: 24 })}>
                Adding it up…
              </RNText>
            ) : null}

            {stats ? (
              <FadeIn duration={280}>
                {/* The number the owner actually came for. */}
                <View
                  style={{
                    marginTop: 18,
                    backgroundColor: t.colors.accentSoft,
                    borderWidth: 1,
                    borderColor: t.colors.accentBorder,
                    borderRadius: 16,
                    padding: 18,
                  }}
                >
                  <RNText style={tx('400', 11, t.colors.accentDeep, { letterSpacing: 1.4 })}>
                    YOUR REVENUE · LAST {stats.windowDays} DAYS
                  </RNText>
                  <RNText
                    style={tx('800', 38, t.colors.accentDeep, { marginTop: 6, letterSpacing: -1.2 })}
                  >
                    {formatINR(stats.revenueMinor)}
                  </RNText>
                  <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 4 })}>
                    Commission from workers and fees from customers, on {formatINR(stats.gmvMinor)}{' '}
                    of completed work
                  </RNText>
                </View>

                <RNText
                  style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}
                >
                  REVENUE PER DAY
                </RNText>
                <View style={{ marginTop: 10 }}>
                  <RevenueBars daily={stats.daily} t={t} onPick={setPicked} picked={picked} />
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 8 })}>
                    {day
                      ? `${day.day} · ${formatINR(day.revenue_minor)} · ${day.posted} posted, ${day.completed} completed`
                      : 'Tap a bar for that day'}
                  </RNText>
                </View>

                <RNText
                  style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 24 })}
                >
                  MONEY IN PROGRESS
                </RNText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                  <Stat
                    label="HELD SAFELY"
                    value={formatINR(stats.escrowHeldMinor)}
                    sub={`${stats.tasksLive} live ${stats.tasksLive === 1 ? 'task' : 'tasks'}`}
                    tone="gold"
                    t={t}
                  />
                  <Stat
                    label="TRANSFERS PENDING"
                    value={formatINR(stats.payoutsPendingMinor)}
                    sub="Owed to workers"
                    t={t}
                  />
                </View>

                <RNText
                  style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 24 })}
                >
                  MARKETPLACE
                </RNText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                  <Stat
                    label="REQUESTS POSTED"
                    value={String(stats.tasksPosted)}
                    sub={`${stats.tasksOpen} still open`}
                    t={t}
                  />
                  <Stat
                    label="COMPLETED"
                    value={String(stats.tasksCompleted)}
                    sub={`${stats.tasksCancelled} cancelled`}
                    tone="accent"
                    t={t}
                  />
                  <Stat
                    label="GOT AN OFFER"
                    value={`${Math.round(stats.quotedRate * 100)}%`}
                    // The number that tells you whether supply is thin.
                    sub={`${stats.quotesPlaced} offers sent`}
                    t={t}
                  />
                  <Stat
                    label="OPEN COMPLAINTS"
                    value={String(stats.disputesOpen)}
                    sub={stats.disputesOpen === 0 ? 'All clear' : 'Needs attention'}
                    tone={stats.disputesOpen > 0 ? 'gold' : 'plain'}
                    t={t}
                  />
                </View>


                <View style={{ height: 28 }} />

              </FadeIn>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
