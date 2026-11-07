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

/** The card at the bottom of the desktop side menu: a small code and one line. */
export function SideNavAppCard() {
  const t = useTheme();
  const apple = useAppleDevice();
  if (apple) return null;
  const { url } = getUrl();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 12,
        borderRadius: 18,
        backgroundColor: t.colors.bg,
        borderWidth: 1,
        borderColor: t.colors.accentBorder,
      }}
    >
      <QrCode value={url} size={72} label="QR code for the TaskDrop Android app" />
      <View style={{ flex: 1 }}>
        <RNText style={tx('800', 13, t.colors.ink)}>Get the Android app</RNText>
        <RNText style={tx('400', 11.5, t.colors.muted, { lineHeight: 16, marginTop: 3 })}>
          Scan with your phone's camera
        </RNText>
      </View>
    </View>
  );
}

/** A "Get the app" pill for the top right of Home; opens a popover with a larger code. */
export function GetAppButton() {
  const t = useTheme();
  const apple = useAppleDevice();
  const [open, setOpen] = useState(false);
  if (apple) return null;
  const { url, shown } = getUrl();
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
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(8,10,12,0.25)' }}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close"
        >
          {/* Taps inside the card must not fall through to the backdrop. */}
          <Pressable
            onPress={() => {}}
            accessible={false}
            style={{
              position: 'absolute',
              right: 40,
              top: 72,
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
    </>
  );
}
