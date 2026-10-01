import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Field, Pill, PrimaryButton, TopBar } from '../components/kit';
import { ListingCard } from '../components/ListingCard';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import { createListing, getTask, removeListing, updateListing, type Task } from '../data/api';
import { CATEGORIES } from '../lib/taskBrief';
import { findContactIssue, contactIssueMessage } from '../lib/mask';
import { roughPlace } from '../lib/place';
import { LocationSheet } from '../components/LocationSheet';

const DELIVERY = [1, 2, 3, 5, 7];
const PREFIX = 'I will ';

/**
 * A worker's gig offer: "I will design your logo", from ₹800, 3-day delivery.
 * Posters browse these and hire straight from them. Opened empty to list a
 * new one, or with a taskId to edit (or take down) an existing listing.
 */
export function ListingEditScreen() {
  const t = useTheme();
  const { back, params } = useNav();
  const { userId } = useAuth();
  const { flash, celebrate } = useActions();
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  const [loaded, setLoaded] = useState<Task | null | undefined>(taskId ? undefined : null);
  const [what, setWhat] = useState('');
  const [details, setDetails] = useState('');
  const [price, setPrice] = useState('');
  const [days, setDays] = useState(3);
  const [category, setCategory] = useState<string | null>(null);
  // Where the gig is offered: remote, or around an area. Only the area name and
  // a pin rounded to about a kilometre are kept -- never the exact spot.
  const [remote, setRemote] = useState(true);
  const [area, setArea] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [pickArea, setPickArea] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    void getTask(taskId).then((task) => {
      setLoaded(task);
      if (!task) return;
      setWhat(task.title.replace(/^i will\s+/i, ''));
      setDetails(task.description ?? '');
      setPrice(String(Math.round(task.benchmark_minor / 100)));
      setDays(Math.max(1, Math.round(task.time_limit_minutes / 1440)));
      setCategory(task.category);
      if (task.loc_label && task.loc_label !== 'Remote' && task.loc_lat != null && task.loc_lng != null) {
        setRemote(false);
        setArea({ label: task.loc_label, lat: task.loc_lat, lng: task.loc_lng });
      }
    });
  }, [taskId]);

  const title = PREFIX + what.trim();
  const priceNum = Number(price);
  const issue = findContactIssue(what + ' ' + details);
  const missing =
    what.trim().length < 4
      ? 'Say what you’ll do after “I will”'
      : details.trim().length < 10
        ? 'Add what’s included — a line or two'
        : !priceNum || priceNum < 50
          ? 'Set a starting price of at least ₹50'
          : issue
            ? contactIssueMessage(issue)
            : !remote && !area
              ? 'Pick the area you work in, or choose Remote'
              : null;

  const save = async () => {
    if (!userId) return;
    if (missing) return flash(missing);
    setBusy(true);
    try {
      const round = (n: number) => Math.round(n * 100) / 100;
      const input = {
        title,
        description: details.trim(),
        priceMinor: Math.round(priceNum * 100),
        deliveryDays: days,
        category,
        locLabel: remote || !area ? 'Remote' : area.label,
        locLat: remote || !area ? null : round(area.lat),
        locLng: remote || !area ? null : round(area.lng),
      };
      if (loaded) await updateListing(loaded.id, input);
      else await createListing(userId, input);
      celebrate(loaded ? 'Service updated' : 'Your service is live');
      back();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save your service');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!loaded) return;
    setBusy(true);
    try {
      await removeListing(loaded.id);
      flash('Service taken down');
      back();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not take it down');
    } finally {
      setBusy(false);
    }
  };

  if (loaded === undefined) {
    return (
      <Screen padded={false}>
        <TopBar title="Edit service" onBack={back} />
        <ActivityIndicator color={t.colors.accent} style={{ marginTop: 40 }} />
      </Screen>
    );
  }

  const preview: Task | null = loaded
    ? { ...loaded, title, description: details, benchmark_minor: Math.round((priceNum || 0) * 100), time_limit_minutes: days * 1440, category, loc_label: remote || !area ? 'Remote' : area.label }
    : null;

  const label = (s: string, top = 20) => (
    <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: top })}>{s}</RNText>
  );

  return (
    <Screen padded={false}>
      <TopBar title={loaded ? 'Edit service' : 'Offer a service'} onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>
          Say what you’ll do and what it costs. Customers looking for this can hire you straight from it.
        </RNText>

        {label('WHAT YOU’LL DO', 16)}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <RNText style={tx('800', 16, t.colors.ink)}>I will</RNText>
          <View style={{ flex: 1 }}>
            <Field
              value={what}
              onChangeText={(v) => setWhat(v.replace(/^i will\s+/i, ''))}
              placeholder="design a logo for your business"
              maxLength={80}
            />
          </View>
        </View>

        <Field
          label="What’s included"
          value={details}
          onChangeText={setDetails}
          multiline
          maxLength={800}
          minHeight={110}
          placeholder="E.g. 3 logo concepts, 2 rounds of changes, final files in PNG and SVG."
          style={{ marginTop: 18 }}
          error={issue ? contactIssueMessage(issue) : null}
        />

        {label('STARTING PRICE')}
        <View style={{ marginTop: 8 }}>
          <Field
            value={price}
            onChangeText={(v) => setPrice(v.replace(/[^0-9]/g, '').slice(0, 7))}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="500"
            left={<RNText style={tx('700', 15, t.colors.muted)}>₹</RNText>}
            error={price && priceNum < 50 ? 'At least ₹50' : null}
            hint="What a basic order costs. You can agree a different price with each customer."
          />
        </View>

        {label('WHERE YOU OFFER THIS')}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 9 }}>
          <Pill label="Remote / online" icon="compass" active={remote} onPress={() => setRemote(true)} />
          <Pill label="In person" icon="pin" active={!remote} onPress={() => { setRemote(false); if (!area) setPickArea(true); }} />
        </View>
        {!remote ? (
          <Pressable
            onPress={() => setPickArea(true)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2 }}
          >
            <Icon name="pin" size={16} color={t.colors.accentDeep} />
            <RNText style={tx('500', 14, area ? t.colors.ink : t.colors.muted, { flex: 1 })} numberOfLines={1}>
              {area ? area.label : 'Pick your area on the map'}
            </RNText>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>{area ? 'Change' : 'Pick'}</RNText>
          </Pressable>
        ) : null}
        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 6 })}>
          {remote ? 'Customers anywhere can hire you.' : 'Customers see only the area, never your exact location.'}
        </RNText>

        {label('USUALLY DELIVERS IN')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
          {DELIVERY.map((d) => (
            <Pill key={d} label={d === 1 ? '1 day' : `${d} days`} active={days === d} onPress={() => setDays(d)} />
          ))}
        </View>

        {label('CATEGORY')}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
          {CATEGORIES.map((c) => (
            <Pill key={c} label={c} active={category === c} onPress={() => setCategory(category === c ? null : c)} />
          ))}
        </View>

        {what.trim() ? (
          <>
            {label('PREVIEW · HOW CUSTOMERS SEE IT')}
            <View style={{ marginTop: 10 }}>
              <ListingCard
                task={preview ?? ({ id: 'preview', title, description: details, benchmark_minor: Math.round((priceNum || 0) * 100), time_limit_minutes: days * 1440, category, status: 'OPEN' } as Task)}
                onPress={() => {}}
              />
            </View>
          </>
        ) : null}

        <PrimaryButton label={loaded ? 'Save changes' : 'Publish service'} onPress={() => void save()} busy={busy} style={{ marginTop: 24 }} />
        {missing ? (
          <RNText style={tx('500', 12, t.colors.muted, { marginTop: 8, textAlign: 'center' })}>{missing}</RNText>
        ) : null}
        {loaded ? (
          <Pressable onPress={() => void remove()} accessibilityRole="button" style={{ alignSelf: 'center', marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="close" size={14} color={t.colors.signal} />
            <RNText style={tx('700', 13, t.colors.signal)}>Take this service down</RNText>
          </Pressable>
        ) : null}
      </ScrollView>
      <LocationSheet
        visible={pickArea}
        askForDetails={false}
        onCancel={() => setPickArea(false)}
        onPick={(picked) => {
          setPickArea(false);
          if (picked.lat == null || picked.lng == null) return flash('Drop a pin on the map');
          setArea({ label: roughPlace(picked.area || picked.label) ?? 'Your area', lat: picked.lat, lng: picked.lng });
        }}
      />
    </Screen>
  );
}
