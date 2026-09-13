import { useState } from 'react';
import { Text as RNText, Pressable, Modal } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { canOpenShareSheet, shareLink, copyLink, type Shareable } from '../lib/share';

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

  const run = async (kind: 'sheet' | 'copy') => {
    const outcome = kind === 'sheet' ? await shareLink(item) : await copyLink(item.url);
    onClose();
    if (outcome === 'copied') flash('Link copied');
    else if (outcome === 'failed') flash('Could not share that link');
    else if (outcome === 'shared') flash('Shared');
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
