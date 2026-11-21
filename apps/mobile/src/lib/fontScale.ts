import { Text, TextInput } from 'react-native';

/**
 * Cap the system font size at 130% for every Text and TextInput (L3-27): at 150% the top bar, tab labels
 * and the map header ran off the screen. Still larger than the normal size, so the setting keeps helping.
 * Text a screen gives its own `maxFontSizeMultiplier` keeps it. Installed once, first thing at start-up.
 */
export const MAX_FONT_SCALE = 1.3;

type Patchable = { render?: (props: Record<string, unknown>, ref: unknown) => unknown; defaultProps?: Record<string, unknown> };

function cap(component: unknown): void {
  const c = component as Patchable;
  try {
    if (typeof c.render === 'function') {
      const original = c.render;
      c.render = function render(this: unknown, props, ref) {
        return original.call(this, { ...props, maxFontSizeMultiplier: props.maxFontSizeMultiplier ?? MAX_FONT_SCALE }, ref);
      };
    } else {
      c.defaultProps = { ...c.defaultProps, maxFontSizeMultiplier: MAX_FONT_SCALE };
    }
  } catch {
    // A component that cannot be patched keeps the system size: a layout nicety, never a crash.
  }
}

let done = false;
export function installFontScaleCap(): void {
  if (done) return;
  done = true;
  cap(Text);
  cap(TextInput);
}
