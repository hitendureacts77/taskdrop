import { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput, type TextStyle } from 'react-native';
import { Screen } from '../components/ui';
import { AmountField } from '../components/AmountField';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { createTask } from '../data/api';
import { DateTimeSheet, formatDeadline } from '../components/DateTimeSheet';
import { LocationSheet } from '../components/LocationSheet';
import { MapPicker } from '../components/MapPicker';
import { tx } from '../components/primitives';

const DRAFTS = {
  worker: [
    { title: 'Bespoke carpentry and joinery', details: 'Made-to-measure furniture, fittings and repairs. Ten years on the tools, own transport.' },
    { title: 'Vintage camera sourcing', details: 'I track down film bodies and lenses, test every shutter before handover.' },
    { title: 'On-the-ground checks', details: 'Queue checks, price scouting, site visits anywhere in central Bengaluru.' },
  ],
  poster: [
    { title: 'Assemble a wardrobe', details: 'Flat-pack unit, two doors, all parts and screws present. Tools needed.' },
    { title: 'Vintage 35mm film camera', details: 'Working SLR, clean viewfinder, tested shutter. Pentax or Olympus preferred, lens included.' },
    { title: 'Check the queue at RTO Indiranagar', details: 'Walk past and tell me how long the licence renewal line is. A photo helps.' },
  ],
} as const;

const PILLAR_LABELS = ['SERVICES', 'PRODUCTS', 'LOCAL INTEL'];
// Chip order -> database enums.
const PILLARS = ['services', 'procurement', 'local_intel'] as const;
const FLAG_VALUES = ['none', 'urgent', 'unique'] as const;
const MEDIA = [
  { glyph: '—', label: 'None' },
  { glyph: '▤', label: 'Photo' },
  { glyph: '▶', label: 'Video' },
];
const FLAGS = ['None', 'Urgent', 'Unique'];
const DURATIONS = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
];

/** Faint map grid + centre pin, standing in for the markup's CSS gradients.
 *  The place label is editable so the poster can retype their area. */
/**
 * What the chosen location looks like on the form.
 *
 * This used to be a drawn grid with a text box over it: it looked like a map,
 * showed nothing, and let someone type an address that contradicted the pin.
 * Now it is the real map at the real point, and it is read-only — the address
 * is edited where it was set, which is the only place both halves are visible.
 */
function LocationPreview({
  label,
  coords,
  onEdit,
}: {
  label: string;
  coords: { lat: number | null; lng: number | null };
  onEdit: () => void;
}) {
  const t = useTheme();

  if (coords.lat == null || coords.lng == null) {
    return (
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel="Set the location for this request"
        style={({ pressed }) => ({
          marginTop: 11,
          padding: 16,
          borderRadius: 12,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: t.colors.line,
          alignItems: "center",
          transform: [{ scale: pressed ? 0.99 : 1 }],
        })}
      >
        <RNText style={tx("700", 14, t.colors.accentDeep)}>Set a location</RNText>
        <RNText style={tx("400", 12, t.colors.muted, { marginTop: 4, textAlign: "center" })}>
          Drop a pin and add the flat number, so a worker can actually find you.
        </RNText>
      </Pressable>
    );
  }

  return (
    <View style={{ marginTop: 11 }}>
      <View style={{ height: 118, borderRadius: 12, overflow: "hidden" }}>
        <MapPicker
          lat={coords.lat}
          lng={coords.lng}
          zoom={16}
          height={118}
          interactive={false}
        />
      </View>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel="Change the location"
        style={({ pressed }) => ({
          marginTop: 9,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 9,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <RNText style={tx("400", 13, t.colors.ink, { flex: 1, lineHeight: 19 })}>{label}</RNText>
      </Pressable>
    </View>
  );
}

export function PostDetailsScreen() {
  const t = useTheme();
  const { params, go, back } = useNav();
  const { mode } = useMode();
  const { celebrate, flash } = useApp();
  const { userId } = useAuth();
  const [busy, setBusy] = useState(false);

  const worker = mode === 'worker';
  const pillar = typeof params.pillar === 'number' ? params.pillar : 0;
  const draft = DRAFTS[worker ? 'worker' : 'poster'][pillar] ?? DRAFTS.poster[0];

  // The pillar's draft copy is a prompt, not a value: seeding the fields with it
  // meant tapping Post published the sample task verbatim.
  const [title, setTitle] = useState<string>('');
  const [details, setDetails] = useState<string>('');
  // No default deadline: the poster opens the calendar and picks one.
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [showDate, setShowDate] = useState(false);
  // No assumed area either; blank means the task isn't tied to one.
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [showLoc, setShowLoc] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [media, setMedia] = useState(1);
  const [flag, setFlag] = useState(0);
  const [promoteOn, setPromoteOn] = useState(false);
  const [budgetIdx, setBudgetIdx] = useState(1);
  const durIdx = 1;

  const budgets = worker ? [50, 80, 150] : [80, 150, 300];
  const promoTotal = budgets[budgetIdx]! * DURATIONS[durIdx]!.days;

  const label = (s: string, extra?: TextStyle, color?: string) => (
    <RNText style={tx('400', 11, color ?? t.colors.muted, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  const publish = async () => {
    if (busy) return;
    const finalTitle = title.trim();
    if (!finalTitle) {
      flash('Give your request a title');
      return;
    }
    if (price === null || price <= 0) {
      flash(worker ? 'Set your rate' : 'Set a benchmark price');
      return;
    }
    if (!worker && !deadline) {
      flash('Pick when this needs to be done by');
      return;
    }
    setBusy(true);
    try {
      if (!userId) throw new Error('Sign in to post');
      await createTask({
        posterId: userId,
        pillar: PILLARS[pillar] ?? 'services',
        title: finalTitle,
        description: details.trim(),
        // Money is stored in paise.
        benchmarkMinor: price * 100,
        // The chosen deadline is what workers quote against.
        timeLimitMinutes: deadline
          ? Math.max(15, Math.round((deadline.getTime() - Date.now()) / 60000))
          : 24 * 60,
        flag: FLAG_VALUES[flag] ?? 'none',
        locLabel: location.trim() || null,
        locLat: coords.lat,
        locLng: coords.lng,
      });
      celebrate(
        promoteOn ? 'Published · nudge your placement' : worker ? 'Listing published' : 'Request posted',
      );
      go(promoteOn ? 'promote' : 'orders');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={back} hitSlop={10}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <RNText style={tx('400', 12, t.colors.muted)}>Draft saved</RNText>
        </View>

        <RNText style={tx('700', 10, t.colors.accentDeep, { letterSpacing: 1.6, marginTop: 16 })}>
          {PILLAR_LABELS[pillar]}
        </RNText>

        {label('TITLE', { marginTop: 18 })}
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={draft.title}
          placeholderTextColor={t.colors.muted}
          style={tx('400', 17, t.colors.ink, {
            marginTop: 9,
            padding: 0,
            paddingBottom: 11,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          })}
        />

        {label('DETAILS', { marginTop: 18 })}
        <TextInput
          value={details}
          onChangeText={setDetails}
          multiline
          placeholder={draft.details}
          placeholderTextColor={t.colors.muted}
          style={tx('400', 14, t.colors.muted, {
            marginTop: 9,
            padding: 0,
            lineHeight: 21.7,
            paddingBottom: 11,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          })}
        />

        {label('PHOTOS OR VIDEO · OPTIONAL', { marginTop: 18 })}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 11 }}>
          {MEDIA.map((m, i) => {
            const on = media === i;
            return (
              <Pressable
                key={m.label}
                onPress={() => setMedia(i)}
                style={({ pressed }) => ({
                  width: 68,
                  height: 68,
                  borderRadius: 12,
                  backgroundColor: on ? t.colors.accentSoft : t.colors.surface2,
                  borderWidth: 1,
                  borderColor: on ? t.colors.accent : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                })}
              >
                <RNText style={tx('400', 17, on ? t.colors.accentDeep : t.colors.muted)}>{m.glyph}</RNText>
                <RNText style={tx('400', 9, on ? t.colors.accentDeep : t.colors.muted)}>{m.label}</RNText>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.line,
              borderRadius: 12,
              padding: 13,
            }}
          >
            {label(worker ? 'YOUR RATE' : 'BENCHMARK', {}, t.colors.muted)}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Pressable
                onPress={() => setPrice((p) => Math.max(100, (p ?? 100) - 100))}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RNText style={tx('400', 15, t.colors.ink)}>−</RNText>
              </Pressable>
              <AmountField
                rupees={price}
                onChangeRupees={setPrice}
                min={100}
                placeholder="Set it"
                // minWidth:0 lets the field shrink inside the half-width card so
                // the "+" stepper never gets pushed out of view.
                style={tx('800', 18, t.colors.accentDeep, { flex: 1, minWidth: 0 })}
              />
              <Pressable
                onPress={() => setPrice((p) => (p ?? 0) + 100)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RNText style={tx('400', 15, t.colors.ink)}>+</RNText>
              </Pressable>
            </View>
          </View>

          {!worker && (
            <View
              style={{
                flex: 1,
                backgroundColor: t.colors.surface,
                borderWidth: 1,
                borderColor: t.colors.accent,
                borderRadius: 12,
                padding: 13,
              }}
            >
              {label('COMPLETE BY ·', {}, t.colors.accentDeep)}
              <Pressable onPress={() => setShowDate(true)} hitSlop={6}>
                <RNText
                  style={tx('700', 15, deadline ? t.colors.ink : t.colors.muted, { marginTop: 8 })}
                >
                  {deadline ? formatDeadline(deadline) : 'Not set'}
                </RNText>
                <RNText style={tx('400', 11, t.colors.accentDeep, { marginTop: 3 })}>
                  {deadline ? 'Tap to change' : 'Tap to pick'}
                </RNText>
              </Pressable>
            </View>
          )}
        </View>

        {!worker && (
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 9 })}>
            Required · workers quote against this deadline.
          </RNText>
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginTop: 18,
          }}
        >
          {label('LOCATION')}
          <Pressable onPress={() => setShowLoc(true)} hitSlop={8}>
            <RNText style={tx('600', 13, t.colors.accentDeep)}>
              {coords.lat != null ? 'Change' : 'Set location'}
            </RNText>
          </Pressable>
        </View>
        <LocationPreview label={location} coords={coords} onEdit={() => setShowLoc(true)} />

        {!worker && (
          <>
            {label('FLAG · OPTIONAL', { marginTop: 18 })}
            <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
              {FLAGS.map((f, i) => {
                const on = flag === i;
                const hue = i === 1 ? t.colors.signal : i === 2 ? t.colors.purple : t.colors.line;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFlag(i)}
                    style={({ pressed }) => ({
                      borderRadius: 999,
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderWidth: 1,
                      borderColor: on ? hue : t.colors.line,
                      backgroundColor: on ? t.colors.surface2 : 'transparent',
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <RNText
                      style={tx('600', 12, on ? (i === 0 ? t.colors.ink : hue) : t.colors.muted)}
                    >
                      {f}
                    </RNText>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            justifyContent: 'space-between',
            marginTop: 18,
            padding: 14,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            {label('PROMOTE · OPTIONAL', {}, t.colors.accentDeep)}
            <RNText style={tx('700', 15, t.colors.ink, { marginTop: 5 })}>
              {worker ? 'Promote my service' : 'Promote my task'}
            </RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3, lineHeight: 16 })}>
              {promoteOn
                ? 'Will boost right after you publish. Pause or stop any time.'
                : 'Reach more people. Pause or stop any time.'}
            </RNText>
          </View>
          <Pressable
            onPress={() => setPromoteOn((v) => !v)}
            style={{
              width: 42,
              height: 24,
              borderRadius: 999,
              padding: 3,
              backgroundColor: promoteOn ? t.colors.accent : t.colors.line,
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                backgroundColor: '#FFFFFF',
                transform: [{ translateX: promoteOn ? 18 : 0 }],
              }}
            />
          </Pressable>
        </View>

        {promoteOn && (
          <View
            style={{
              marginTop: 10,
              padding: 13,
              backgroundColor: t.colors.accentSoft,
              borderWidth: 1,
              borderColor: t.colors.accentBorder,
              borderRadius: 12,
            }}
          >
            {label('DAILY BUDGET', {}, t.colors.accentDeep)}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
              {budgets.map((b, i) => {
                const on = budgetIdx === i;
                return (
                  <Pressable
                    key={b}
                    onPress={() => setBudgetIdx(i)}
                    style={({ pressed }) => ({
                      flex: 1,
                      borderRadius: 10,
                      paddingVertical: 10,
                      alignItems: 'center',
                      backgroundColor: on ? t.colors.accentSoft : 'transparent',
                      borderWidth: 1,
                      borderColor: on ? t.colors.accent : t.colors.line,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <RNText style={tx('600', 13, on ? t.colors.ink : t.colors.muted)}>₹{b}</RNText>
                  </Pressable>
                );
              })}
            </View>
            <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 9 })}>
              Will boost right after publishing · ₹{promoTotal.toLocaleString('en-IN')} over{' '}
              {DURATIONS[durIdx]!.label}
            </RNText>
          </View>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressable
          onPress={publish}
          style={({ pressed }) => ({
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>
            {promoteOn ? 'Publish & promote' : worker ? 'Publish listing' : 'Post request'}
          </RNText>
        </Pressable>
      </View>

      <DateTimeSheet
        visible={showDate}
        initial={deadline ?? undefined}
        onCancel={() => setShowDate(false)}
        onConfirm={(d) => {
          setDeadline(d);
          setShowDate(false);
        }}
      />

      <LocationSheet
        visible={showLoc}
        onCancel={() => setShowLoc(false)}
        onPick={(place) => {
          setLocation(place.label);
          setCoords({ lat: place.lat, lng: place.lng });
          setShowLoc(false);
        }}
      />
    </Screen>
  );
}
