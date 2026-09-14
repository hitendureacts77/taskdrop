import { useEffect, useState } from 'react';
import { View, Text as RNText, Image, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { signedMediaUrl } from '../lib/media';

/**
 * The photo or video attached to a task, wherever it needs showing.
 *
 * The bucket is private, so there is no URL to put in a src — one has to be
 * signed first, and that is asynchronous. Hence the placeholder while it
 * resolves: the alternative is a box that pops in and shifts the layout.
 *
 * Signing is per-thumbnail here, which is right for a detail screen. A list
 * should sign its whole page at once with signedMediaUrls and pass the result
 * down as `url`, rather than firing one request per row.
 */

export function TaskMediaThumb({
  path,
  kind,
  seconds,
  size,
  url,
  radius = 11,
}: {
  path: string | null;
  kind: 'image' | 'video' | null;
  seconds?: number | null;
  /** A square of this side, or fill the parent when left out. */
  size?: number;
  /** An already-signed URL, when the caller signed a whole page in one go. */
  url?: string | null;
  radius?: number;
}) {
  const t = useTheme();
  const [resolved, setResolved] = useState<string | null>(url ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url) {
      setResolved(url);
      return;
    }
    if (!path) return;
    let alive = true;
    setFailed(false);
    void signedMediaUrl(path).then((signed) => {
      if (!alive) return;
      if (signed) setResolved(signed);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [path, url]);

  if (!path || !kind) return null;

  const box = {
    ...(size ? { width: size, height: size } : { flex: 1 }),
    borderRadius: radius,
    overflow: 'hidden' as const,
    backgroundColor: t.colors.surface2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexShrink: 0,
  };

  if (failed) {
    return (
      <View style={box}>
        <RNText style={tx('400', 10, t.colors.muted, { textAlign: 'center', paddingHorizontal: 6 })}>
          Not available
        </RNText>
      </View>
    );
  }

  if (!resolved) {
    return (
      <View style={box}>
        <ActivityIndicator size="small" color={t.colors.muted} />
      </View>
    );
  }

  return (
    <View style={box}>
      {kind === 'image' ? (
        <Image
          source={{ uri: resolved }}
          resizeMode="cover"
          style={{ width: '100%', height: '100%' }}
          accessibilityLabel="Photo attached to this request"
          onError={() => setFailed(true)}
        />
      ) : (
        // A <video> is not worth pulling in for a thumbnail; the tile says what
        // it is, and the detail screen is where it gets played.
        <View
          style={{
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.colors.surface2,
          }}
          accessibilityLabel="Video attached to this request"
        >
          <Svg width={size && size < 70 ? 18 : 26} height={size && size < 70 ? 18 : 26} viewBox="0 0 24 24">
            <Path d="M8 5.5v13l11-6.5-11-6.5Z" fill={t.colors.accent} />
          </Svg>
        </View>
      )}

      {kind === 'video' && seconds ? (
        <RNText
          style={tx('600', 9, '#FFFFFF', {
            position: 'absolute',
            bottom: 4,
            right: 4,
            backgroundColor: 'rgba(0,0,0,0.6)',
            paddingHorizontal: 5,
            paddingVertical: 2,
            borderRadius: 5,
            overflow: 'hidden',
          })}
        >
          {seconds}s
        </RNText>
      ) : null}
    </View>
  );
}
