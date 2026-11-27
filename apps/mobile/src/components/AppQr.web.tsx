import { useState } from 'react';
import { Modal, Pressable, Text as RNText, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { GET_PATH, browserInfo, isAppleMobile } from '../lib/appDownload';
import { Icon } from './Icon';
import { QrCode } from './QrCode';
import { tx } from './primitives';

/** The address the code opens: this site's own /get page (so a preview deploy points at itself). */
function getUrl(): { url: string; shown: string } {
  const { origin, host } = window.location;
  return { url: `${origin}${GET_PATH}`, shown: `${host}${GET_PATH}` };
}

/** The app is Android-only for now, so Apple devices are not offered it. */
function useAppleDevice(): boolean {
  const { ua, touch } = browserInfo();
  return isAppleMobile(ua, touch);
}

/**
 * The bottom of the desktop side menu (D31 web boards): a quiet "Get the Android app" button that opens the same
 * code as Home's button, in a popover beside the menu.
 */
export function SideNavAppCard() {
  const t = useTheme();
  const apple = useAppleDevice();
  const [open, setOpen] = useState(false);
  if (apple) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Get the Android app"
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          height: 40,
          borderRadius: 12,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderWidth: 1,
          borderColor: t.colors.line,
          backgroundColor: hovered || pressed ? t.colors.surface2 : t.colors.surface,
        })}
      >
        <Icon name="smartphone" size={16} color={t.colors.ink} strokeWidth={2} />
        <RNText style={tx('700', 13.5, t.colors.ink)}>Get the Android app</RNText>
      </Pressable>
      <AppQrPopover open={open} onClose={() => setOpen(false)} place={{ left: 24, bottom: 72 }} />
    </>
  );
}

/** The desktop top bar's quiet "Get the app" link (the side menu's button, moved with the menu); the code opens under it. */
export function TopNavAppLink() {
  const t = useTheme();
  const apple = useAppleDevice();
  const [open, setOpen] = useState(false);
  if (apple) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Get the Android app"
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          height: 36,
          borderRadius: 10,
          paddingHorizontal: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: hovered || pressed ? t.colors.surface2 : 'transparent',
        })}
      >
        <Icon name="smartphone" size={15} color={t.colors.text} strokeWidth={2} />
        <RNText style={tx('600', 13.5, t.colors.text)}>Get the app</RNText>
      </Pressable>
      <AppQrPopover open={open} onClose={() => setOpen(false)} place={{ right: 24, top: 72 }} />
    </>
  );
}

/** A "Get the app" pill for the top right of Home; opens a popover with a larger code. */
export function GetAppButton() {
  const t = useTheme();
  const apple = useAppleDevice();
  const [open, setOpen] = useState(false);
  if (apple) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Get the app"
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          height: 40,
          borderRadius: 999,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderWidth: 1,
          borderColor: t.colors.accentBorder,
          backgroundColor: hovered || pressed ? t.colors.accentBorder : t.colors.accentSoft,
        })}
      >
        <Icon name="smartphone" size={16} color={t.colors.accentDeep} strokeWidth={2.2} />
        <RNText style={tx('800', 14, t.colors.accentDeep)}>Get the app</RNText>
      </Pressable>
      <AppQrPopover open={open} onClose={() => setOpen(false)} place={{ right: 40, top: 72 }} />
    </>
  );
}

/** The larger code, in a card over a dimmed page; `place` puts the card next to the button that opened it. */
function AppQrPopover({
  open,
  onClose,
  place,
}: {
  open: boolean;
  onClose: () => void;
  place: { left?: number; right?: number; top?: number; bottom?: number };
}) {
  const t = useTheme();
  const { url, shown } = getUrl();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(8,10,12,0.25)' }}
        onPress={onClose}
        accessibilityLabel="Close"
      >
        {/* Taps inside the card must not fall through to the backdrop. */}
        <Pressable
          onPress={() => {}}
          accessible={false}
          style={{
            position: 'absolute',
            ...place,
            width: 300,
            padding: 20,
            borderRadius: 22,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 40,
            shadowOffset: { width: 0, height: 20 },
            elevation: 12,
          }}
        >
          <RNText accessibilityRole="header" style={tx('800', 17, t.colors.ink)}>
            Get TaskDrop on your phone
          </RNText>
          <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19, marginTop: 4 })}>
            Point your Android phone's camera at the code. It opens {shown}.
          </RNText>
          <View style={{ alignItems: 'center', marginTop: 14 }}>
            <QrCode value={url} size={150} label="QR code for the TaskDrop Android app" />
          </View>
          <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 12 })}>
            On an iPhone, use the website
          </RNText>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
