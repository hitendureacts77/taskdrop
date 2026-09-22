import React from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';

const PHONE_WIDTH = 430;
const PHONE_MAX_HEIGHT = 900;
// Below this browser width we're already on a real phone (or a narrow
// window) — let the app fill it edge to edge like normal mobile web.
const WIDE_BREAKPOINT = 700;
const FRAME_RADIUS = 28;
const PORTAL_STYLE_ID = 'taskdrop-modal-frame';

/**
 * Keeps every <Modal> inside the phone frame on web.
 *
 * react-native-web mounts each Modal in a bare <div> appended straight to
 * <body> (react-native-web/dist/exports/Modal/ModalPortal.js), and the modal
 * content inside it is `position: fixed; inset: 0`. Both sit outside our
 * frame, so the date picker, location sheet, share sheet and the rest were
 * covering the whole browser window instead of the phone.
 *
 * Pinning the portal to the frame's box fixes both halves at once: the
 * `transform` centres it, and — because any non-none transform makes an
 * element the containing block for `position: fixed` descendants — it also
 * re-anchors the modal content to the frame instead of the viewport.
 *
 * The portal div stays mounted (empty) while a sheet is closed, so it is
 * click-through; only its children take pointer events.
 */
function useFramedModals(active: boolean) {
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let el = document.getElementById(PORTAL_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = PORTAL_STYLE_ID;
      document.head.appendChild(el);
    }
    // A modal portal div is created bare: no id (the app root has one), no
    // class, and no inline style — which also excludes
    // react-native-safe-area-context's hidden inset probe, the other
    // body-level div, since that one is inline-styled.
    el.textContent = active
      ? `body > div:not([id]):not([class]):not([style]) {
           position: fixed;
           top: 50%;
           left: 50%;
           width: ${PHONE_WIDTH}px;
           height: min(100vh, ${PHONE_MAX_HEIGHT}px);
           transform: translate(-50%, -50%);
           overflow: hidden;
           border-radius: ${FRAME_RADIUS}px;
           pointer-events: none;
         }
         body > div:not([id]):not([class]):not([style]) > * { pointer-events: auto; }`
      : '';
  }, [active]);
}

/**
 * Makes the app web-friendly without touching any of the 25 screens' pixel
 * layouts. TaskDrop's screens are built to an exact mobile design (see
 * AGENTS.md / docs/design) and stretching them full-bleed across a desktop
 * browser would distort every one of them.
 *
 * On native (Android/iOS) and on an actual mobile browser this is a no-op —
 * children render exactly as before. Only once the browser is wider than a
 * phone do we center the app in a fixed phone-width column with a framed
 * look, the same pattern Twitter/Instagram use for their mobile-first web
 * apps. Resizing the window live re-evaluates the breakpoint.
 */
export function WebShell({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const t = useTheme();
  const framed = Platform.OS === 'web' && width >= WIDE_BREAKPOINT;
  // Before the early return: hooks cannot be conditional.
  useFramedModals(framed);

  if (!framed) {
    return <>{children}</>;
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.colors.surface2,
        minHeight: '100vh' as unknown as number,
      }}
    >
      <View
        style={{
          width: PHONE_WIDTH,
          height: Math.min(height, PHONE_MAX_HEIGHT),
          borderRadius: 28,
          overflow: 'hidden',
          backgroundColor: t.colors.bg,
          borderWidth: 1,
          borderColor: t.colors.line,
          boxShadow: '0 24px 64px rgba(0,0,0,0.28)' as unknown as undefined,
        }}
      >
        {children}
      </View>
    </View>
  );
}
