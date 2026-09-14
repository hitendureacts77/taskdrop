import { useState } from 'react';
import { View, Text as RNText, Pressable, Modal, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import {
  canOpenShareSheet,
  shareLink,
  copyLink,
  shareTo,
  SHARE_TARGETS,
  type Shareable,
  type ShareTargetId,
} from '../lib/share';

/**
 * The share control.
 *
 * "Share to…" hands off to the operating system's own sheet, which is the only
 * thing that knows which apps are actually installed — WhatsApp, Instagram,
 * Telegram, mail, whatever is really there. We never hardcode that list: it
 * would advertise apps the user doesn't have and miss the ones they do.
 *
 * "Copy link" is always offered, because it works on every platform and is what
 * people reach for when they want to paste somewhere we can't reach.
 */
export function useShare(flash: (msg: string) => void) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState<Shareable | null>(null);

  const start = (next: Shareable | null) => {
    if (!next) {
      flash('This one has no link to share yet');
      return;
    }
    setItem(next);
    setOpen(true);
  };

  return { open, item, start, close: () => setOpen(false) };
}

export function ShareSheet({
  visible,
  item,
  onClose,
  flash,
}: {
  visible: boolean;
  item: Shareable | null;
  onClose: () => void;
  flash: (msg: string) => void;
}) {
  const t = useTheme();
  if (!item) return null;

  const say = (outcome: string, id?: ShareTargetId) => {
    if (outcome === 'copied') {
      // Instagram cannot be handed a link, so the copy is the whole action and
      // needs to say what to do next rather than a bare "Link copied".
      flash(id === 'instagram' ? 'Link copied — paste it in your story or DM' : 'Link copied');
    } else if (outcome === 'failed') flash('Could not share that link');
    else if (outcome === 'shared') flash('Shared');
  };

  const run = async (kind: 'sheet' | 'copy') => {
    const outcome = kind === 'sheet' ? await shareLink(item) : await copyLink(item.url);
    onClose();
    say(outcome);
  };

  const toApp = async (id: ShareTargetId) => {
    const outcome = await shareTo(id, item);
    onClose();
    say(outcome, id);
  };

  const rows: { label: string; hint: string; onPress: () => void }[] = [
    ...(canOpenShareSheet()
      ? [
          {
            label: 'Share to…',
            hint: 'WhatsApp, Instagram and anything else installed',
            onPress: () => void run('sheet'),
          },
        ]
      : []),
    { label: 'Copy link', hint: item.url, onPress: () => void run('copy') },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 28,
          }}
        >
          <RNText style={tx('800', 18, t.colors.ink, { letterSpacing: -0.4 })} numberOfLines={2}>
            {item.title}
          </RNText>

          {/* Named apps first, the way people actually think about sharing:
              they want to send it to someone on WhatsApp, not to contemplate
              a generic sheet. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingVertical: 16, paddingRight: 6 }}
          >
            {SHARE_TARGETS.map((target) => (
              <Pressable
                key={target.id}
                onPress={() => void toApp(target.id)}
                accessibilityRole="button"
                accessibilityLabel={`${target.label} — ${target.hint}`}
                style={({ pressed }) => ({
                  width: 72,
                  alignItems: 'center',
                  gap: 7,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                })}
              >
                <View
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 999,
                    backgroundColor: t.colors.surface,
                    borderWidth: 1,
                    borderColor: t.colors.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText style={tx('800', 15, t.colors.ink)}>{target.glyph}</RNText>
                </View>
                <RNText style={tx('600', 11, t.colors.muted)} numberOfLines={1}>
                  {target.label}
                </RNText>
              </Pressable>
            ))}
          </ScrollView>

          {rows.map((r) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              style={({ pressed }) => ({
                marginTop: 12,
                backgroundColor: t.colors.surface,
                borderWidth: 1,
                borderColor: t.colors.line,
                borderRadius: 12,
                padding: 14,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <RNText style={tx('700', 15, t.colors.ink)}>{r.label}</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })} numberOfLines={1}>
                {r.hint}
              </RNText>
            </Pressable>
          ))}

          <Pressable onPress={onClose} style={{ marginTop: 16, alignItems: 'center', padding: 8 }}>
            <RNText style={tx('600', 14, t.colors.muted)}>Cancel</RNText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
