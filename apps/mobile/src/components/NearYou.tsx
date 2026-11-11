import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { workersNear, type NearbyWorker } from '../data/extras';
import { useMyArea } from '../lib/useMyArea';
import { presenceOf } from '../lib/presence';
import { Icon } from './Icon';
import { SectionTitle, Shimmer } from './kit';
import { JobsMap, type JobPin } from './JobsMap';
import { activeFirst, areaName, farText, offerOf, personPin, ratingOf } from './mapPins';
import { HelperSheet } from './HelperSheet';
import type { IconName } from './Icon';
import { LocationSheet } from './LocationSheet';
import { ModeLockSheet } from './ModeLockSheet';
import { cardSurface } from './ui';
import { Pressy, tx } from './primitives';

/** The reach of the poster's "Near you" map, in km. */
const NEAR_KM = 5;

/**
 * The poster's map, the hero of Explore: helpers round their area. Soft circles show the
 * area, never the spot. Tasks (and their prices) are Earn-mode only (plan D26), so the
 * "Tasks" pill is locked and opens the switch sheet. Tapping a circle or a row
 * opens a peek with the person. The area is the one set on Home.
 */
export function NearYou({ first = false }: { active?: boolean; first?: boolean }) {
  const t = useTheme();
  const { go } = useNav();
  const { area, choose } = useMyArea();
  const centre = area;
  const [pickPlace, setPickPlace] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const onSetArea = () => setPickPlace(true);
  const openMap = (mode: 'jobs' | 'people') => centre && go('nearMap', { mode, centre: { lat: centre.lat, lng: centre.lng }, radiusKm: NEAR_KM });

  return (
    <View>
      <SectionTitle
        title="Helpers near you"
        icon="users"
        action={centre ? 'Full map' : undefined}
        onAction={() => openMap('people')}
        style={{ marginTop: first ? 4 : 32 }}
      />
      {centre ? (
        <View style={{ marginTop: 10, flexDirection: 'row' }}>
          {/* Same look as PillTabs; the second pill is the other mode's side, locked. */}
          <View style={{ flexDirection: 'row', gap: 2, padding: 3, borderRadius: 999, backgroundColor: t.colors.surface2 }}>
            <View
              accessibilityRole="tab"
              accessibilityState={{ selected: true }}
              style={{ paddingVertical: 8, paddingHorizontal: 15, borderRadius: 999, backgroundColor: t.isDark ? t.colors.line : t.colors.surface }}
            >
              <RNText style={tx('800', 13, t.colors.ink)}>Helpers</RNText>
            </View>
            <Pressable
              onPress={() => setLockOpen(true)}
              accessibilityRole="tab"
              accessibilityLabel="Tasks"
              accessibilityHint="Locked. Opens a switch to Earn mode"
              accessibilityState={{ selected: false }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 15, borderRadius: 999, transform: [{ scale: pressed ? 0.96 : 1 }] })}
            >
              <Icon name="lock" size={12} color={t.colors.muted} />
              <RNText style={tx('600', 13, t.colors.muted)}>Tasks</RNText>
            </Pressable>
          </View>
        </View>
      ) : null}
      {!centre ? (
        <Pressy onPress={onSetArea} style={[cardSurface(t), { marginTop: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <Icon name="pin" size={18} color={t.colors.accentDeep} />
          <RNText style={tx('600', 13.5, t.colors.ink, { flex: 1 })}>Set your area to see helpers near you</RNText>
          <Icon name="chevronRight" size={16} color={t.colors.muted} />
        </Pressy>
      ) : (
        <HelpersNear centre={centre} onOpenMap={() => openMap('people')} />
      )}
      <ModeLockSheet visible={lockOpen} want="jobs" onClose={() => setLockOpen(false)} />
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
                    </RNText>
                    {/* The price on its own line, so a long service name never hides it. */}
                    <RNText style={tx('400', 11, t.colors.muted, { maxWidth: 170 })} numberOfLines={1}>
                      {o.price ? <RNText style={tx('800', 11, t.colors.accentDeep)}>{`from ${o.price} · `}</RNText> : null}
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
