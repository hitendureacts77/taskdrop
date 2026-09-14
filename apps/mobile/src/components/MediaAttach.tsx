import { useState } from 'react';
import { View, Text as RNText, Pressable, Image, ActivityIndicator } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { pickMedia, uploadMedia, removeMedia, MediaError, type TaskMedia } from '../lib/media';
import { MEDIA } from '@taskdrop/rules';

/**
 * Attaching a photo or a video to a post.
 *
 * The upload starts the moment a file is chosen rather than at submit, for two
 * reasons: the preview can then show real progress instead of freezing the
 * Post button for however long a video takes, and by the time someone finishes
 * typing the description the file is usually already up.
 *
 * Removing an attachment deletes it from the bucket too. Otherwise every
 * discarded photo would sit there forever, still costing storage and still
 * readable by anyone signed in.
 */

function CameraIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.1-1.8A1 1 0 0 1 9.3 3.7h5.4a1 1 0 0 1 .9.5L16.7 6h1.8A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-8Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12.5} r={3.4} stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

function VideoIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={6} width={12.5} height={12} rx={2.5} stroke={color} strokeWidth={1.7} />
      <Path
        d="m16 11 4-2.4v6.8L16 13v-2Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PlayBadge({ color, onSurface }: { color: string; onSurface: string }) {
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path d="M8 5.5v13l11-6.5-11-6.5Z" fill={onSurface} />
      </Svg>
    </View>
  );
}

type State =
  | { phase: 'empty' }
  | { phase: 'working'; uri: string; kind: 'image' | 'video' }
  | { phase: 'ready'; uri: string; media: TaskMedia };

export function MediaAttach({
  value,
  onChange,
}: {
  value: TaskMedia | null;
  onChange: (next: TaskMedia | null) => void;
}) {
  const t = useTheme();
  const [state, setState] = useState<State>({ phase: 'empty' });
  const [error, setError] = useState<string | null>(null);

  const choose = async (kind: 'image' | 'video') => {
    setError(null);
    try {
      // Straight off the press, with nothing awaited first: a browser blocks a
      // file dialog that is not tied to the gesture, and does so silently.
      const picked = await pickMedia(kind);
      if (!picked) return;

      setState({ phase: 'working', uri: picked.uri, kind });
      const uploaded = await uploadMedia(picked);
      setState({ phase: 'ready', uri: picked.uri, media: uploaded });
      onChange(uploaded);
    } catch (e) {
      setState({ phase: 'empty' });
      onChange(null);
      setError(
        e instanceof MediaError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not attach that file',
      );
    }
  };

  const clear = () => {
    if (value?.path) void removeMedia(value.path);
    setState({ phase: 'empty' });
    onChange(null);
    setError(null);
  };

  const addButton = (kind: 'image' | 'video', label: string, icon: React.ReactNode) => (
    <Pressable
      onPress={() => void choose(kind)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderStyle: 'dashed',
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      {icon}
      <RNText style={tx('700', 13, t.colors.ink)}>{label}</RNText>
    </Pressable>
  );

  if (state.phase === 'empty') {
    return (
      <View style={{ marginTop: 11 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {addButton('image', 'Add photo', <CameraIcon color={t.colors.accentDeep} />)}
          {addButton('video', 'Add video', <VideoIcon color={t.colors.accentDeep} />)}
        </View>
        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 8, lineHeight: 16 })}>
          One photo, or a video up to {MEDIA.MAX_VIDEO_SECONDS}s. Workers quote far more
          accurately when they can see the job.
        </RNText>
        {error && (
          <RNText style={tx('600', 12, t.colors.signal, { marginTop: 8, lineHeight: 17 })}>
            {error}
          </RNText>
        )}
      </View>
    );
  }

  const working = state.phase === 'working';
  const kind = working ? state.kind : state.media.kind;
  const seconds = state.phase === 'ready' ? state.media.seconds : undefined;

  return (
    <View style={{ marginTop: 11 }}>
      <View
        style={{
          height: 168,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: t.colors.surface2,
          borderWidth: 1,
          borderColor: t.colors.line,
        }}
      >
        {/* A video's local URI is not something <Image> can draw, so a video
            shows a play badge rather than a broken frame. */}
        {kind === 'image' ? (
          <Image
            source={{ uri: state.uri }}
            resizeMode="cover"
            style={{ width: '100%', height: '100%', opacity: working ? 0.45 : 1 }}
            accessibilityLabel="The photo attached to this request"
          />
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              opacity: working ? 0.45 : 1,
            }}
          >
            <PlayBadge color={t.colors.accent} onSurface={t.colors.onAccent} />
            <RNText style={tx('700', 13, t.colors.ink)}>
              Video{seconds ? ` · ${seconds}s` : ''}
            </RNText>
          </View>
        )}

        {working && (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
            }}
          >
            <ActivityIndicator color={t.colors.accent} />
            <RNText style={tx('700', 12, t.colors.ink)}>Uploading…</RNText>
          </View>
        )}

        {!working && (
          <Pressable
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel="Remove this attachment"
            hitSlop={8}
            style={({ pressed }) => ({
              position: 'absolute',
              right: 10,
              top: 10,
              width: 32,
              height: 32,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.colors.bg,
              borderWidth: 1,
              borderColor: t.colors.line,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <RNText style={tx('700', 15, t.colors.ink)}>×</RNText>
          </Pressable>
        )}
      </View>

      {!working && (
        <Pressable
          onPress={() => void choose(kind)}
          accessibilityRole="button"
          accessibilityLabel="Replace this attachment"
          style={{ marginTop: 9, alignSelf: 'flex-start' }}
        >
          <RNText style={tx('700', 13, t.colors.accentDeep)}>Replace</RNText>
        </Pressable>
      )}

      {error && (
        <RNText style={tx('600', 12, t.colors.signal, { marginTop: 8, lineHeight: 17 })}>
          {error}
        </RNText>
      )}
    </View>
  );
}
