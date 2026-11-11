import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { workerServices, type NearbyWorker } from '../data/extras';
import type { Task } from '../data/api';
import { taskToFeedRow } from '../lib/openTask';
import { useReducedMotion } from '../lib/motion';
import { FaceDisc } from './MapMarkers';
import { areaName, farText, firstName, initialsOf, mainSkill, ratingOf } from './mapPins';
import { categoryIcon } from './WorkCard';
import { PresenceLabel } from './PresenceDot';
import { Icon } from './Icon';
import { Shimmer, rupees } from './kit';
import { FadeIn, Pressy, tx } from './primitives';

const CARD_W = 196;

/** "Done in 1 day" from a listing's delivery time. */
function doneIn(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const days = Math.max(1, Math.round(minutes / 1440));
  return `Done in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Who a helper is and what they sell (plan D13). The map shows only what
 * someone offers; their name, face, rating and service cards appear here, once
 * a poster taps them. The cards open the listing itself. Used by the full map
 * (as a bottom sheet) and by the Explore card (inline).
 */
export function HelperSheet({ worker: w, onClose }: { worker: NearbyWorker; onClose?: () => void }) {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();
  const reduced = useReducedMotion();
  const listed = (w.service_count ?? (w.top_service ? 1 : 0)) > 0;
  const [services, setServices] = useState<Task[] | null>(listed ? null : []);

  useEffect(() => {
    if (!listed) {
      setServices([]);
      return;
    }
    let alive = true;
    setServices(null);
    void workerServices(w.id)
      .then((r) => alive && setServices(r))
      .catch(() => alive && setServices([]));
    return () => {
      alive = false;
    };
  }, [w.id, listed]);

  const name = w.display_name || w.username || 'Helper';
  const first = firstName(name);
  const rating = ratingOf(w);
  const skill = mainSkill(w.skills);
  // Reduce Motion: a quick fade, no slide.
  const rise = (delay: number) => (reduced ? { duration: 120, delay: 0, translateY: 0 } : { duration: 260, delay, translateY: 8 });

  return (
    <View style={{ gap: 12 }}>
      <FadeIn key={w.id} {...rise(120)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <FaceDisc face={{ initials: initialsOf(name), live: false, photo: w.avatar_url }} seed={w.id} size={56} rimWidth={0} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <RNText style={tx('800', 18, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
              {name}
            </RNText>
            <RNText style={tx('700', 12.5, t.colors.ink, { marginTop: 2 })} numberOfLines={1}>
              {rating ? `★ ${rating}` : 'New on TaskDrop'}
              {rating ? (
                <RNText style={tx('600', 12.5, t.colors.muted)}>{` · ${w.worker_rating_count} review${w.worker_rating_count === 1 ? '' : 's'}`}</RNText>
              ) : null}
            </RNText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <PresenceLabel lastSeen={w.last_seen_at} />
              <RNText style={tx('400', 12, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
                · {areaName(w.loc_label)} area · {farText(w.km)}
              </RNText>
            </View>
          </View>
          {onClose ? (
            <Pressy
              onPress={onClose}
              label="Close"
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="close" size={15} color={t.colors.ink} />
            </Pressy>
          ) : null}
        </View>
      </FadeIn>

      {(w.skills ?? []).length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {(w.skills ?? []).slice(0, 4).map((s) => (
            <View key={s} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: t.colors.purpleSoft }}>
              <RNText style={tx('700', 11.5, t.colors.purpleDeep)}>{mainSkill([s])}</RNText>
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <RNText style={tx('800', 14.5, t.colors.ink)}>
          {listed ? `Services by ${first}` : 'Services'}
          {services && services.length > 0 ? <RNText style={tx('700', 14.5, t.colors.muted)}>{` · ${services.length}`}</RNText> : null}
        </RNText>
        {services === null ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Shimmer height={150} style={{ width: CARD_W }} />
            <Shimmer height={150} style={{ width: CARD_W }} />
          </View>
        ) : services.length === 0 ? (
          <View style={{ marginTop: 10, flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.colors.line, backgroundColor: t.colors.bg }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="briefcase" size={16} color={t.colors.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <RNText style={tx('800', 13.5, t.colors.ink)}>No services listed yet</RNText>
              <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 3, lineHeight: 18 })}>
                Post a task for {skill.toLowerCase()} and {first} can send you an offer.
              </RNText>
            </View>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10, marginHorizontal: -16 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
            {services.map((s, i) => {
              const main = s.id === w.top_service?.id;
              const time = doneIn(s.time_limit_minutes);
              return (
                <FadeIn key={s.id} {...(reduced ? { duration: 120 } : { duration: 260, delay: 160 + i * 40 })}>
                  <View style={{ width: CARD_W, padding: 12, gap: 6, borderRadius: 18, borderWidth: 1.5, borderColor: main ? t.colors.purple : t.colors.line, backgroundColor: t.colors.bg }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.colors.purpleSoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={categoryIcon(s.category)} size={16} color={t.colors.purpleDeep} />
                      </View>
                      {main ? (
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: t.colors.purpleSoft }}>
                          <RNText style={tx('800', 10, t.colors.purpleDeep)}>On the map</RNText>
                        </View>
                      ) : null}
                    </View>
                    <RNText style={tx('800', 13.5, t.colors.ink, { lineHeight: 18, minHeight: 36 })} numberOfLines={2}>
                      {s.title}
                    </RNText>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                      <RNText style={tx('800', 16, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(s.benchmark_minor / 100)}</RNText>
                      {time ? <RNText style={tx('600', 11, t.colors.muted)} numberOfLines={1}>{time}</RNText> : null}
                    </View>
                    <Pressy
                      onPress={() => go('taskDetail', { row: taskToFeedRow({ ...s, poster: null }) })}
                      label={`See service: ${s.title}`}
                      style={{ marginTop: 2, height: 36, borderRadius: 11, borderWidth: 1.5, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <RNText style={tx('800', 12.5, t.colors.ink)}>See service</RNText>
                    </Pressy>
                  </View>
                </FadeIn>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressy
          onPress={() => go('publicProfile', { userId: w.id })}
          style={{ flex: 1, height: 44, borderRadius: 999, borderWidth: 1.5, borderColor: t.colors.line, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' }}
        >
          <RNText style={tx('700', 14, t.colors.ink)}>View full profile</RNText>
        </Pressy>
        {/* Only in Hire mode: an Earn-mode helper has no reason to post a task for another helper. */}
        {mode === 'poster' ? (
          <Pressy
            onPress={() => go('aiPost')}
            style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}
          >
            <RNText style={tx('800', 14, t.colors.onBtn)}>Post a task</RNText>
          </Pressy>
        ) : null}
      </View>
    </View>
  );
}
