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
    });
  }, [taskId]);

  const title = PREFIX + what.trim();
  const priceNum = Number(price);
  const issue = findContactIssue(what + ' ' + details);
  const ready = what.trim().length >= 6 && details.trim().length >= 20 && priceNum >= 50 && !issue;

  const save = async () => {
    if (!userId || !ready) return;
    setBusy(true);
    try {
      const input = { title, description: details.trim(), priceMinor: Math.round(priceNum * 100), deliveryDays: days, category };
      if (loaded) await updateListing(loaded.id, input);
      else await createListing(userId, input);
      celebrate(loaded ? 'Listing updated' : 'Your gig is live');
      back();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save your listing');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!loaded) return;
    setBusy(true);
    try {
      await removeListing(loaded.id);
      flash('Listing taken down');
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
        <TopBar title="Edit listing" onBack={back} />
        <ActivityIndicator color={t.colors.accent} style={{ marginTop: 40 }} />
      </Screen>
    );
  }

  const preview: Task | null = loaded
    ? { ...loaded, title, description: details, benchmark_minor: Math.round((priceNum || 0) * 100), time_limit_minutes: days * 1440, category }
    : null;

  const label = (s: string, top = 20) => (
    <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginTop: top })}>{s}</RNText>
  );

  return (
    <Screen padded={false}>
      <TopBar title={loaded ? 'Edit listing' : 'List a gig'} onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>
          Say what you’ll do and what it costs. Posters looking for this can hire you straight from it.
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
            hint="What a basic order costs. You can agree a different price with each poster."
          />
        </View>

        {label('DELIVERY TIME')}
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
            {label('PREVIEW · HOW POSTERS SEE IT')}
            <View style={{ marginTop: 10 }}>
              <ListingCard
                task={preview ?? ({ id: 'preview', title, description: details, benchmark_minor: Math.round((priceNum || 0) * 100), time_limit_minutes: days * 1440, category, status: 'OPEN' } as Task)}
                onPress={() => {}}
              />
            </View>
          </>
        ) : null}

        <PrimaryButton label={loaded ? 'Save changes' : 'Publish gig'} onPress={() => void save()} busy={busy} disabled={!ready} style={{ marginTop: 24 }} />
        {loaded ? (
          <Pressable onPress={() => void remove()} accessibilityRole="button" style={{ alignSelf: 'center', marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="close" size={14} color={t.colors.signal} />
            <RNText style={tx('700', 13, t.colors.signal)}>Take this listing down</RNText>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
