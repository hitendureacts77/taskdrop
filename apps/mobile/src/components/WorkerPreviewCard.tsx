import { Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import { tx } from './primitives';

/**
 * "How customers see you": a small live preview of the worker profile, shown in
 * the desktop aside of worker setup (FormPage). It only echoes what the person
 * has typed so far, so it updates as they go. The caller sits under RoleTheme
 * worker, so the colours here are Earn's blue.
 */
export function WorkerPreviewCard({
  name,
  skills,
  language,
  area,
  bio,
}: {
  name?: string | null;
  skills: string[];
  language?: string;
  area?: string | null;
  bio?: string;
}) {
  const t = useTheme();
  const initial = name?.trim().charAt(0).toUpperCase() ?? '';
  const bioLine = bio?.trim() ?? '';
  const empty = !skills.length;
  return (
    <View
      accessibilityLabel="How customers see you"
      style={{
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderRadius: t.radius.lg,
        padding: 20,
      }}
    >
      <Text style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>HOW CUSTOMERS SEE YOU</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: t.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {initial ? (
            <Text style={tx('800', 18, t.colors.accentDeep)}>{initial}</Text>
          ) : (
            <Icon name="user" size={22} color={t.colors.accentDeep} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={tx('700', 16, t.colors.ink)} numberOfLines={1}>
            {name?.trim() || 'Your name'}
          </Text>
          {area ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
              <Icon name="pin" size={13} color={t.colors.muted} />
              <Text style={tx('500', 13, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
                {area}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {skills.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
          {skills.map((s) => (
            <View
              key={s}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: t.colors.accentSoft }}
            >
              <Text style={tx('600', 12, t.colors.accentDeep)}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {language ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
          <Icon name="globe" size={14} color={t.colors.muted} />
          <Text style={tx('500', 13, t.colors.muted)}>Speaks {language}</Text>
        </View>
      ) : null}

      {bioLine ? (
        <Text style={tx('400', 13, t.colors.ink, { marginTop: 12, lineHeight: 19 })} numberOfLines={4}>
          {bioLine}
        </Text>
      ) : null}

      {empty ? (
        <Text style={tx('400', 13, t.colors.muted, { marginTop: 14, lineHeight: 19 })}>
          Add a skill to see how your profile looks.
        </Text>
      ) : null}
    </View>
  );
}
