import { Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { tx } from './primitives';

/**
 * A live preview of a post, shown in the desktop aside of the posting screens
 * (AiPostScreen, PostDetailsScreen on FormPage; docs/design/desktop-web/PLAN.md
 * package 13). It only echoes what the person has filled in so far, so it updates
 * as they go; it reads nothing and sends nothing. Desktop only: the phone layout
 * never draws it.
 */
export function PostPreviewCard({
  heading,
  title,
  titleFallback,
  description,
  price,
  tags = [],
  facts = [],
  emptyNote,
}: {
  /** The small caps line on top, e.g. "AS WORKERS WILL SEE IT". */
  heading: string;
  title: string;
  /** Shown, muted, while there is no title yet. */
  titleFallback: string;
  description?: string;
  /** The amount to show, already formatted (e.g. "₹1,200"), or null while it is not set. */
  price?: string | null;
  tags?: string[];
  facts?: { icon: IconName; text: string }[];
  /** A muted line under an empty preview. */
  emptyNote?: string;
}) {
  const t = useTheme();
  const name = title.trim();
  const body = description?.trim() ?? '';
  const empty = !name && !body;
  return (
    <View
      accessibilityLabel={heading.charAt(0) + heading.slice(1).toLowerCase()}
      style={{
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderRadius: t.radius.lg,
        overflow: 'hidden',
      }}
    >
      <View style={{ backgroundColor: t.colors.accentSoft, paddingHorizontal: 20, paddingVertical: 10 }}>
        <Text style={tx('700', 11, t.colors.accentDeep, { letterSpacing: 1.2 })}>{heading}</Text>
      </View>
      <View style={{ padding: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <Text
            style={tx('800', 17, name ? t.colors.ink : t.colors.muted, { flex: 1, minWidth: 0, letterSpacing: -0.3, lineHeight: 23 })}
            numberOfLines={3}
          >
            {name || titleFallback}
          </Text>
          {price ? (
            <Text style={tx('800', 17, t.colors.accentDeep, { lineHeight: 23, fontVariant: ['tabular-nums'] })}>{price}</Text>
          ) : null}
        </View>

        {body ? (
          <Text style={tx('400', 13, t.colors.text, { marginTop: 10, lineHeight: 19 })} numberOfLines={5}>
            {body}
          </Text>
        ) : null}

        {facts.length ? (
          <View style={{ gap: 8, marginTop: 14 }}>
            {facts.map((f) => (
              <View key={f.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={f.icon} size={14} color={t.colors.muted} />
                <Text style={tx('500', 13, t.colors.muted, { flex: 1, minWidth: 0 })} numberOfLines={2}>
                  {f.text}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {tags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
            {tags.map((s) => (
              <View key={s} style={{ backgroundColor: t.colors.surface2, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
                <Text style={tx('600', 11, t.colors.text)}>{s}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {empty && emptyNote ? (
          <Text style={tx('400', 13, t.colors.muted, { marginTop: 12, lineHeight: 19 })}>{emptyNote}</Text>
        ) : null}
      </View>
    </View>
  );
}
