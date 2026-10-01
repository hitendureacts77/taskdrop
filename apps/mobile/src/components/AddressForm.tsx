import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { MapPicker } from './MapPicker';
import type { AddressDetails, AddressTag } from '../lib/location';

/**
 * The half of an address a map cannot know.
 *
 * The pin says which building. This says which door — the flat number, the
 * floor, the landmark that stops a worker phoning to ask which gate. Reverse
 * geocoding will never produce any of it, so it is typed, once, by the only
 * person who knows.
 *
 * Only the flat/house number is required. Everything else earns its place by
 * being useful, and a form that demands a landmark from someone who does not
 * have one is a form people abandon.
 */

/** The building-ish head of a resolved address, which is what line 2 wants. */
function firstPart(area: string): string {
  const head = area.split(',')[0]?.trim() ?? '';
  // Before the place name arrives the area is just the pin's coordinates;
  // "12.9716" is not a building.
  return /^-?\d{1,3}\.\d+$/.test(head) ? '' : head;
}

const TAGS: { key: AddressTag; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'work', label: 'Work' },
  { key: 'other', label: 'Other' },
];

function PinIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={2.6} stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

function BackIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5l-7 7 7 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function AddressForm({
  area,
  pin,
  initial,
  topInset,
  bottomInset,
  onBack,
  onSave,
}: {
  /** What the pin resolved to. Shown, and used to pre-fill the street line. */
  area: string;
  pin: { lat: number; lng: number };
  initial?: AddressDetails;
  topInset: number;
  bottomInset: number;
  /** Back to the map, with whatever has been typed so far kept. */
  onBack: (draft: AddressDetails) => void;
  onSave: (details: AddressDetails) => void;
}) {
  const t = useTheme();

  const [line1, setLine1] = useState(initial?.line1 ?? '');
  // Pre-filled from the pin, because for most addresses the map already got
  // the street right and retyping it is busywork. Editable, because sometimes
  // it did not.
  const [line2, setLine2] = useState(initial?.line2 ?? firstPart(area));
  // Tapping Confirm before the reverse-geocode lands is easy to do, and it used
  // to mean the building line simply never pre-filled. So the answer is allowed
  // to arrive late — but only while the field is still untouched, because
  // overwriting what someone typed would be far worse than not helping.
  const line2Touched = useRef(Boolean(initial?.line2));
  useEffect(() => {
    if (line2Touched.current) return;
    setLine2(firstPart(area));
  }, [area]);
  const [landmark, setLandmark] = useState(initial?.landmark ?? '');
  const [directions, setDirections] = useState(initial?.directions ?? '');
  const [tag, setTag] = useState<AddressTag | undefined>(initial?.tag);
  const [tagName, setTagName] = useState(initial?.tagName ?? '');
  const [showError, setShowError] = useState(false);

  const line1Ref = useRef<TextInput>(null);

  const draft = (): AddressDetails => ({
    line1: line1.trim(),
    line2: line2.trim() || undefined,
    landmark: landmark.trim() || undefined,
    directions: directions.trim() || undefined,
    tag,
    tagName: tag === 'other' ? tagName.trim() || undefined : undefined,
  });

  const save = () => {
    if (!line1.trim()) {
      // Say what is wrong and put the cursor there, rather than disabling the
      // button and leaving someone to work out why it does nothing.
      setShowError(true);
      line1Ref.current?.focus();
      return;
    }
    onSave(draft());
  };

  const field = (
    label: string,
    value: string,
    onChangeText: (v: string) => void,
    opts: {
      placeholder?: string;
      required?: boolean;
      invalid?: boolean;
      multiline?: boolean;
      ref?: React.RefObject<TextInput | null>;
      autoFocus?: boolean;
    } = {},
  ) => (
    <View style={{ marginTop: 16 }}>
      <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>
        {label.toUpperCase()}
        {opts.required ? ' *' : ''}
      </RNText>
      <TextInput
        ref={opts.ref}
        value={value}
        onChangeText={(v) => {
          onChangeText(v);
          if (opts.invalid) setShowError(false);
        }}
        placeholder={opts.placeholder}
        placeholderTextColor={t.colors.muted}
        autoFocus={opts.autoFocus}
        multiline={opts.multiline}
        style={tx('400', 15, t.colors.ink, {
          marginTop: 7,
          paddingVertical: 11,
          paddingHorizontal: 13,
          borderRadius: 11,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: opts.invalid ? t.colors.signal : t.colors.line,
          minHeight: opts.multiline ? 68 : undefined,
          textAlignVertical: opts.multiline ? 'top' : 'center',
        })}
      />
      {opts.invalid && (
        <RNText style={tx('600', 12, t.colors.signal, { marginTop: 6 })}>
          A worker cannot find a building without this.
        </RNText>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      behavior="padding"
    >
      {/* The pin stays in view, so it is obvious which building is being
          described — and one tap goes back to move it. */}
      <View style={{ height: 150 + topInset, paddingTop: topInset, backgroundColor: t.colors.bg }}>
        <MapPicker lat={pin.lat} lng={pin.lng} zoom={17} radius={0} interactive={false} />
        <Pressable
          onPress={() => onBack(draft())}
          accessibilityRole="button"
          accessibilityLabel="Back to the map"
          style={{
            position: 'absolute',
            left: 12,
            top: topInset + 10,
            width: 38,
            height: 38,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.colors.bg,
            borderWidth: 1,
            borderColor: t.colors.line,
          }}
        >
          <BackIcon color={t.colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => onBack(draft())}
          accessibilityRole="button"
          accessibilityLabel="Change the pin"
          style={({ pressed }) => ({
            position: 'absolute',
            right: 12,
            bottom: 12,
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderRadius: 999,
            backgroundColor: t.colors.bg,
            borderWidth: 1,
            borderColor: t.colors.line,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <RNText style={tx('700', 12, t.colors.accentDeep)}>Change</RNText>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: bottomInset + 110,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>
          Enter complete address
        </RNText>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 9,
            marginTop: 12,
            padding: 12,
            borderRadius: 11,
            backgroundColor: t.colors.surface2,
          }}
        >
          <View style={{ paddingTop: 1 }}>
            <PinIcon color={t.colors.accentDeep} />
          </View>
          <RNText style={tx('400', 13, t.colors.muted, { flex: 1, lineHeight: 19 })}>
            {area || `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`}
          </RNText>
        </View>

        {field('House / Flat / Floor', line1, setLine1, {
          placeholder: 'e.g. Flat 402, 4th floor',
          required: true,
          invalid: showError && !line1.trim(),
          ref: line1Ref,
          autoFocus: true,
        })}

        {field(
          'Building / Apartment / Street',
          line2,
          (v) => {
            line2Touched.current = true;
            setLine2(v);
          },
          {
            placeholder: 'e.g. Casa Rouge, Road No. 8',
          },
        )}

        {field('Landmark', landmark, setLandmark, {
          placeholder: 'e.g. opposite the Reliance Fresh',
        })}

        {field('Directions to reach', directions, setDirections, {
          placeholder: 'Gate code, which entrance, anything that saves a phone call',
          multiline: true,
        })}

        <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4, marginTop: 22 })}>
          SAVE THIS AS
        </RNText>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
          {TAGS.map((o) => {
            const on = tag === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => setTag(on ? undefined : o.key)}
                accessibilityRole="button"
                accessibilityLabel={`Save this address as ${o.label}`}
                accessibilityState={{ selected: on }}
                style={({ pressed }) => ({
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 999,
                  backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
                  borderWidth: 1,
                  borderColor: on ? t.colors.accent : t.colors.line,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                <RNText style={tx('700', 13, on ? t.colors.accentDeep : t.colors.muted)}>
                  {o.label}
                </RNText>
              </Pressable>
            );
          })}
        </View>

        {tag === 'other' &&
          field('Name this place', tagName, setTagName, { placeholder: "e.g. Mum's flat" })}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: bottomInset + 6,
          backgroundColor: t.colors.bg,
          borderTopWidth: 1,
          borderTopColor: t.colors.line,
        }}
      >
        <Pressable
          onPress={save}
          accessibilityRole="button"
          accessibilityLabel="Save this address"
          style={({ pressed }) => ({
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 15,
            alignItems: 'center',
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <RNText style={tx('700', 15, t.colors.onAccent)}>Save address</RNText>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
