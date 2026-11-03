import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { attachPosters, type Task, type TaskWithPoster } from '../data/api';
import { tasksNear, workersNear, type NearbyWorker } from '../data/extras';
import { taskToFeedRow } from '../lib/openTask';
import { useMyArea } from '../lib/useMyArea';
import { presenceOf } from '../lib/presence';
import { roughPlace } from '../lib/place';
import { Icon } from './Icon';
import { PillTabs, SectionTitle, Shimmer, rupees, timeLeft } from './kit';
import { categoryIcon } from './WorkCard';
import { JobsMap, type JobPin } from './JobsMap';
import { TopUpBadge } from './TopUpBadge';
import { activeFirst, areaName, farText, jobPin, offerOf, personPin, ratingOf } from './mapPins';
import { HelperSheet } from './HelperSheet';
import type { IconName } from './Icon';
import { LocationSheet } from './LocationSheet';
import { cardSurface } from './ui';
import { Pressy, tx } from './primitives';

/** The reach of the poster's "Near you" map, in km. */
const NEAR_KM = 5;

/**
 * The poster's map, the hero of Explore: helpers round their area, and (one tap
 * away) the open tasks round it with what each one pays. Soft circles show the
 * area, never the spot. Seeing real prices nearby is how a poster gets a feel
 * for what to offer, instead of a suggested range. Tapping a circle or a row
 * opens a peek with the person or the task. The area is the one set on Home.
 */
export function NearYou({ active, first = false }: { active: boolean; first?: boolean }) {
  const t = useTheme();
  const { go } = useNav();
  const { area, choose } = useMyArea();
  const centre = area;
  const [pickPlace, setPickPlace] = useState(false);
  const onSetArea = () => setPickPlace(true);
  const [rows, setRows] = useState<(TaskWithPoster & { km: number })[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  // Helpers first (plan D11); the open tasks with their prices stay one tap away.
  const [view, setView] = useState(0);

  useEffect(() => {
    if (!centre || !active || view !== 1) return;
    let alive = true;
    void tasksNear(centre, NEAR_KM, 12)
      .then(async (r) => {
        const withPeople = await attachPosters(r);
        if (alive) {
          setLoadedAt(Date.now());
          setRows(withPeople.map((x, i) => ({ ...x, km: r[i]!.km })));
        }
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [centre, active, view]);

  const pins = (rows ?? []).map((r) => jobPin(r, loadedAt)).filter((x): x is JobPin => x !== null);
  const openMap = (mode: 'jobs' | 'people') => centre && go('nearMap', { mode, centre: { lat: centre.lat, lng: centre.lng }, radiusKm: NEAR_KM });
  const sel = rows?.find((r) => r.id === picked) ?? null;
  const areaOf = (r: Task) => (r.loc_label ? roughPlace(r.loc_label)?.split(',')[0] : null) || 'Nearby';
  const far = (km: number) => (km < 1 ? 'under 1 km' : `~${km.toFixed(km < 10 ? 1 : 0)} km`);

  return (
    <View>
      <SectionTitle
        title={view === 0 ? 'Helpers near you' : 'Near you right now'}
        icon={view === 0 ? 'users' : 'pin'}
        action={centre ? 'Full map' : undefined}
        onAction={() => openMap(view === 0 ? 'people' : 'jobs')}
        style={{ marginTop: first ? 4 : 32 }}
      />
      {centre ? (
        <View style={{ marginTop: 10, flexDirection: 'row' }}>
          <PillTabs tabs={[{ label: 'Helpers' }, { label: 'Task prices' }]} active={view} onPick={setView} inset={0} />
        </View>
      ) : null}
      {!centre ? (
        <Pressy onPress={onSetArea} style={[cardSurface(t), { marginTop: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <Icon name="pin" size={18} color={t.colors.accentDeep} />
          <RNText style={tx('600', 13.5, t.colors.ink, { flex: 1 })}>Set your area to see tasks and prices near you</RNText>
          <Icon name="chevronRight" size={16} color={t.colors.muted} />
        </Pressy>
      ) : view === 0 ? (
        <HelpersNear centre={centre} onOpenMap={() => openMap('people')} />
      ) : rows === null ? (
        <Shimmer height={260} style={{ marginTop: 12 }} />
      ) : (
        <>
          <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4 })}>
            {rows.length === 0
              ? `No open tasks within ${NEAR_KM} km yet`
              : `${rows.length} open task${rows.length === 1 ? '' : 's'} within ${NEAR_KM} km · prices set by the people who posted them`}
          </RNText>
          <View style={{ marginTop: 12 }}>
            <JobsMap me={centre} pins={pins} selectedId={picked} onSelect={setPicked} height={280} ringKm={NEAR_KM} onExpand={() => openMap('jobs')} />
          </View>

          {sel ? (
            <View style={[cardSurface(t, 20), { marginTop: 12, padding: 16 }]}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 0.9 })} numberOfLines={1}>
                    {(sel.category ?? 'Task').toUpperCase()}
                  </RNText>
                  <RNText style={tx('800', 17, t.colors.ink, { marginTop: 4, letterSpacing: -0.3 })} numberOfLines={2}>
                    {sel.title}
                  </RNText>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <RNText style={tx('800', 22, t.colors.ink, { fontVariant: ['tabular-nums'], letterSpacing: -0.5 })}>
                    {rupees(sel.benchmark_minor / 100)}
                  </RNText>
                  <TopUpBadge pct={sel.topup_pct} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 10, borderRadius: 14, backgroundColor: t.colors.surface2 }}>
                <View style={{ width: 30, height: 30, borderRadius: 999, backgroundColor: t.colors.accent + '26', borderWidth: 1.5, borderColor: t.colors.accent, borderStyle: 'dashed' }} />
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 13, t.colors.ink)}>
                    {areaOf(sel)} area · {far(sel.km)} away
                  </RNText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Icon name="lock" size={11} color={t.colors.muted} />
                    <RNText style={tx('400', 11.5, t.colors.muted, { flexShrink: 1 })}>Exact address unlocks once someone is hired</RNText>
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Pressy
                  onPress={() => go('taskDetail', { row: taskToFeedRow(sel) })}
                  style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}
                >
                  <RNText style={tx('800', 14, t.colors.onBtn)}>Open task</RNText>
                </Pressy>
                <Pressy
                  onPress={() => go('aiPost', { similar: sel })}
                  style={{ flex: 1, height: 44, borderRadius: 999, borderWidth: 1.5, borderColor: t.colors.line, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' }}
                >
                  <RNText style={tx('700', 14, t.colors.ink)}>Post one like this</RNText>
                </Pressy>
              </View>
            </View>
          ) : null}

          {rows.length > 0 ? (
            <View style={[cardSurface(t, 20), { marginTop: 12, paddingHorizontal: 14 }]}>
              {rows.slice(0, 4).map((r, i) => (
                <Pressable
                  key={r.id}
                  onPress={() => setPicked(r.id === picked ? null : r.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: r.id === picked }}
                  accessibilityLabel={`${r.title}, ${rupees(r.benchmark_minor / 100)}, ${areaOf(r)} area, ${far(r.km)} away`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: t.colors.line,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 999,
                      backgroundColor: t.colors.accent + '22',
                      borderWidth: 1.5,
                      borderColor: t.colors.accent + '55',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={categoryIcon(r.category ?? '')} size={16} color={t.colors.accentDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>
                      {r.title}
                    </RNText>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                      {areaOf(r)} area · {far(r.km)}
                      {timeLeft(r.due_at) ? ` · ${timeLeft(r.due_at)}` : ''}
                    </RNText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <RNText style={tx('800', 16, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(r.benchmark_minor / 100)}</RNText>
                    <TopUpBadge pct={r.topup_pct} compact />
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
      <LocationSheet
        visible={pickPlace}
        askForDetails={false}
        onCancel={() => setPickPlace(false)}
        onPick={(p) => {
          setPickPlace(false);
          void choose(p);
        }}
      />
    </View>
  );
}

/** A helper's service icon, with a green dot when they have TaskDrop open. */
function OfferDot({ icon, live, size }: { icon: IconName; live: boolean; size: number }) {
  const t = useTheme();
  return (
    <View>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.purpleSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={Math.round(size * 0.45)} color={t.colors.purpleDeep} />
      </View>
      {live ? (
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 999, backgroundColor: '#22C55E', borderWidth: 2, borderColor: t.colors.surface }} />
      ) : null}
    </View>
  );
}

/**
 * The poster's map of helpers round their area (plans D11, D13): each one is
 * what they offer, a service and its price, never a name; a green dot when
 * someone has TaskDrop open, and the people active now listed first. Tap a pin,
 * a service or a row to see who it is: name, face and service cards
 * (HelperSheet). The expand button opens the full map.
 */
function HelpersNear({ centre, onOpenMap }: { centre: { lat: number; lng: number }; onOpenMap: () => void }) {
  const t = useTheme();
  const [list, setList] = useState<NearbyWorker[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const at = Date.now();
    void workersNear(centre, NEAR_KM, 12)
      .then((r) => alive && (setNow(at), setFailed(false), setList(activeFirst(r, at))))
      .catch(() => alive && (setFailed(true), setList([])));
    return () => {
      alive = false;
    };
  }, [centre]);

  if (list === null) return <Shimmer height={260} style={{ marginTop: 12 }} />;
  const pins = list.map((w) => personPin(w, now)).filter((p): p is JobPin => p !== null);
  const live = list.filter((w) => presenceOf(w.last_seen_at, now).online).length;
  const sel = list.find((w) => w.id === picked) ?? null;

  return (
    <>
      <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4 })}>
        {failed
          ? 'Could not load helpers just now. Try again in a moment.'
          : list.length === 0
          ? `No helpers within ${NEAR_KM} km yet. Post a task and people nearby or online can still send offers.`
          : `${list.length} ${list.length === 1 ? 'person' : 'people'} within ${NEAR_KM} km who can help${live > 0 ? ` · ${live} active now` : ''}`}
      </RNText>
      <View style={{ marginTop: 12 }}>
        <JobsMap me={centre} pins={pins} selectedId={picked} onSelect={setPicked} height={280} ringKm={NEAR_KM} tone="people" onExpand={onOpenMap} />
      </View>

      {/* What people offer, one swipe: active now first. Names wait for a tap (plan D13). */}
      {list.length > 0 ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14 }}>
            <RNText style={tx('800', 14, t.colors.ink)}>Services nearby</RNText>
            <RNText style={tx('600', 11.5, t.colors.muted)}>active now first</RNText>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginHorizontal: -4 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
            {list.map((w) => {
              const live = presenceOf(w.last_seen_at, now).online;
              const on = w.id === picked;
              const o = offerOf(w);
              return (
                <Pressable
                  key={w.id}
                  onPress={() => setPicked(on ? null : w.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${o.what}${o.price ? `, from ${o.price}` : ''}${live ? ', active now' : ''}, ${areaName(w.loc_label)} area`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 8,
                    paddingLeft: 8,
                    paddingRight: 12,
                    borderRadius: 16,
                    borderWidth: 1.5,
                    borderColor: on ? t.colors.purple : t.colors.line,
                    backgroundColor: t.colors.surface,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <OfferDot icon={o.icon} live={live} size={30} />
                  <View>
                    <RNText style={tx('800', 12.5, t.colors.ink, { maxWidth: 170 })} numberOfLines={1}>
                      {o.what}
                      {o.price ? <RNText style={tx('800', 12.5, t.colors.accentDeep)}>{` · ${o.price}`}</RNText> : null}
                    </RNText>
                    <RNText style={tx('400', 11, t.colors.muted)} numberOfLines={1}>
                      {areaName(w.loc_label)} · {farText(w.km)}
                    </RNText>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}

      {sel ? (
        <View style={[cardSurface(t, 20), { marginTop: 12, padding: 16 }]}>
          <HelperSheet worker={sel} onClose={() => setPicked(null)} />
        </View>
      ) : null}

      {list.length > 0 ? (
        <View style={[cardSurface(t, 20), { marginTop: 12, paddingHorizontal: 14 }]}>
          {list.slice(0, 4).map((w, i) => {
            const o = offerOf(w);
            const live = presenceOf(w.last_seen_at, now).online;
            const rating = ratingOf(w);
            return (
              <Pressable
                key={w.id}
                onPress={() => setPicked(w.id === picked ? null : w.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: w.id === picked }}
                accessibilityLabel={`${o.what}${o.price ? `, from ${o.price}` : ''}, ${presenceOf(w.last_seen_at, now).label}, ${farText(w.km)} away. Tap to see who`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.colors.line,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <OfferDot icon={o.icon} live={live} size={38} />
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>
                    {o.what}
                  </RNText>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                    {[o.price ? `from ${o.price}` : 'Skill', rating ? `★ ${rating}` : 'New', `${areaName(w.loc_label)}`, farText(w.km)].join(' · ')}
                  </RNText>
                </View>
                <Icon name="chevronRight" size={16} color={t.colors.muted} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </>
  );
}
