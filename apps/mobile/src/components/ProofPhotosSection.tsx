import { useEffect, useState } from 'react';
import { View, Text as RNText, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { Icon } from './Icon';
import { Badge, timeAgo } from './kit';
import { tx } from './primitives';
import { cardSurface } from './ui';
import { useTheme } from '../providers/ThemeProvider';
import { workerProofPhotos, type ProofPhotos } from '../data/api';
import { imageSource, signedMediaUrls } from '../lib/media';

/**
 * Before-and-after photos from a helper's finished jobs, shown only where the
 * customer allowed it when posting (migration 134). Drag across a photo to
 * wipe between before and after. Shows nothing when there are none.
 */
export function ProofPhotosSection({ workerId }: { workerId: string }) {
  const t = useTheme();
  const [jobs, setJobs] = useState<ProofPhotos[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = (await workerProofPhotos(workerId)).filter(
        (j) => j.files.some((f) => f.label === 'before') && j.files.some((f) => f.label === 'after'),
      );
      if (!alive) return;
      setJobs(list);
      const paths = list.flatMap((j) => j.files.filter((f) => f.label).map((f) => f.path));
      if (paths.length) {
        const signed = await signedMediaUrls(paths, 'full');
        if (alive) setUrls(signed);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workerId]);

  if (jobs.length === 0) return null;
  return (
    <>
      <RNText style={tx('800', 15, t.colors.ink, { marginTop: 20 })}>Before and after</RNText>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>From finished jobs, shared with the customer’s OK</RNText>
      {jobs.map((j) => {
        const before = j.files.find((f) => f.label === 'before');
        const after = j.files.find((f) => f.label === 'after');
        return (
          <View key={j.task_id} style={{ ...cardSurface(t, 18), padding: 10, marginTop: 12 }}>
            <Wipe before={before ? urls[before.path] : undefined} after={after ? urls[after.path] : undefined} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 4 }}>
              <View style={{ flex: 1 }}>
                <RNText style={tx('800', 14, t.colors.ink)} numberOfLines={1}>
                  {j.title}
                </RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                  {[j.category, j.completed_at ? timeAgo(j.completed_at) : null].filter(Boolean).join(' · ')}
                </RNText>
              </View>
              <Badge label="Customer agreed" tone="accent" />
            </View>
          </View>
        );
      })}
    </>
  );
}

/** One photo pair: the before photo is drawn over the after one up to the divider, which follows a drag. */
function Wipe({ before, after }: { before?: string; after?: string }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [split, setSplit] = useState(0.5);
  const follow = (e: GestureResponderEvent) => {
    if (width > 0) setSplit(Math.min(1, Math.max(0, e.nativeEvent.locationX / width)));
  };
  const tag = (text: string, side: 'left' | 'right') => (
    <View style={{ position: 'absolute', top: 8, [side]: 8, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.65)' }}>
      <RNText style={tx('800', 10, '#FFFFFF', { letterSpacing: 0.6 })}>{text}</RNText>
    </View>
  );
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={follow}
      onResponderMove={follow}
      accessibilityLabel="Before and after photos. Drag across to compare."
      style={{ height: 220, borderRadius: 14, overflow: 'hidden', backgroundColor: t.colors.surface2 }}
    >
      {after ? <Image source={imageSource(after)} style={{ position: 'absolute', inset: 0 }} contentFit="cover" /> : null}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: width * split, overflow: 'hidden' }} pointerEvents="none">
        {before ? <Image source={imageSource(before)} style={{ width, height: 220 }} contentFit="cover" /> : null}
      </View>
      {tag('BEFORE', 'left')}
      {tag('AFTER', 'right')}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: width * split - 1.5, width: 3, backgroundColor: '#FFFFFF' }} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 90,
          left: width * split - 20,
          width: 40,
          height: 40,
          borderRadius: 40,
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
        }}
      >
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <Icon name="chevronRight" size={14} color="#121417" strokeWidth={2.4} />
        </View>
        <Icon name="chevronRight" size={14} color="#121417" strokeWidth={2.4} />
      </View>
    </View>
  );
}
