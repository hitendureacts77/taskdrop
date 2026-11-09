import { Platform } from 'react-native';

const STYLE_ID = 'taskdrop-scrollbar';

/**
 * Web only. react-native-web draws the browser's own thick scroll bar on every
 * ScrollView and FlatList, which looks unfinished next to the rest of the app.
 * One thin, low-contrast bar everywhere: invisible until you hover the area
 * that scrolls. Neutral grey with alpha reads on both light and dark themes.
 * Lists that opt out with showsVerticalScrollIndicator={false} stay hidden.
 */
const CSS = `
  * { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  *:hover { scrollbar-color: rgba(128, 128, 128, 0.38) transparent; }
  *::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-corner { background: transparent; }
  *::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
  *:hover::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.38); }
  *::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.6); }
`;

export function installWebScrollbar() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

installWebScrollbar();
