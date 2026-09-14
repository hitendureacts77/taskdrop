import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { platformStats, type PlatformStats } from '../data/api';
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
  const { flash } = useApp();

  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

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
          <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
        </Pressable>

        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.72, marginTop: 14 })}>
          Your business
        </RNText>

        {denied ? (
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 16, lineHeight: 21 })}>
            These numbers are for admins. Ask an owner to add your account to the admin role.
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
                    20% worker commission + 3% poster fee on {formatINR(stats.gmvMinor)} of
                    completed work
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
                  MONEY IN FLIGHT
                </RNText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                  <Stat
                    label="HELD IN ESCROW"
                    value={formatINR(stats.escrowHeldMinor)}
                    sub={`${stats.tasksLive} live ${stats.tasksLive === 1 ? 'task' : 'tasks'}`}
                    tone="gold"
                    t={t}
                  />
                  <Stat
                    label="PAYOUTS PENDING"
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
                    label="GOT A QUOTE"
                    value={`${Math.round(stats.quotedRate * 100)}%`}
                    // The number that tells you whether supply is thin.
                    sub={`${stats.quotesPlaced} quotes placed`}
                    t={t}
                  />
                  <Stat
                    label="DISPUTES OPEN"
                    value={String(stats.disputesOpen)}
                    sub={stats.disputesOpen === 0 ? 'Nothing to settle' : 'Needs attention'}
                    tone={stats.disputesOpen > 0 ? 'gold' : 'plain'}
                    t={t}
                  />
                </View>

                <RNText
                  style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 24 })}
                >
                  PEOPLE
                </RNText>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 10,
                    marginTop: 10,
                    marginBottom: 28,
                  }}
                >
                  <Stat
                    label="ACTIVE"
                    value={String(stats.activeUsers)}
                    sub="Posted or quoted"
                    t={t}
                  />
                  <Stat
                    label="NEW"
                    value={String(stats.newUsers)}
                    sub={`${stats.totalUsers} in total`}
                    t={t}
                  />
                  <Stat
                    label="WORKER RATING"
                    value={stats.avgWorkerRating > 0 ? `★ ${stats.avgWorkerRating}` : '—'}
                    sub={stats.avgWorkerRating > 0 ? 'Average this period' : 'No reviews yet'}
                    t={t}
                  />
                </View>
              </FadeIn>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
