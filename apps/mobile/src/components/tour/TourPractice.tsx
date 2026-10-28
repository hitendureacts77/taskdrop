import { type ReactNode } from 'react';
import { Text as RNText, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../providers/ThemeProvider';
import { tx } from '../primitives';
import { TOUR_COPY, tourTabNames, type TourNumbers, type TourPath, type TourView } from '../../lib/tour';
import { useTourTarget } from './targets';

/**
 * The pretend task. Everything here is drawn by the tour: nothing is read from
 * or sent to the server, so nothing is posted and no money moves. The names,
 * places and amounts are made up and always carry PRACTICE or EXAMPLE.
 */
export type Practice = {
  placeChosen?: boolean;
  offerPicked?: boolean;
  moneyHeld?: boolean;
  paid?: boolean;
  jobSent?: boolean;
  picked?: boolean;
};

const TASK = 'Fix my leaking kitchen tap';
const OFFER = 600; // rupees, made up

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function TourPractice({ view, practice, path, numbers }: { view: TourView; practice: Practice; path: TourPath; numbers: TourNumbers }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  if (view === 'real' || view === 'done') return null;
  const wide = width > 560;
  const fee = Math.round(OFFER * numbers.feePct);
  const body = (() => {
    switch (view) {
      case 'post':
        return <PostView practice={practice} />;
      case 'offers':
        return <OffersView practice={practice} total={OFFER + fee} />;
      case 'vault':
        return <VaultView practice={practice} path={path} fee={fee} feePct={numbers.feePct} />;
      case 'jobs':
        return <JobsView />;
      case 'job':
        return <JobView />;
      case 'alert':
        return <AlertView />;
      case 'thread':
        return <ThreadView />;
      case 'tabs':
        return <TabsView path={path} />;
      default:
        return null;
    }
  })();
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: t.colors.bg,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 12,
        alignItems: 'center',
      }}
    >
      <View style={{ width: '100%', maxWidth: wide ? 480 : undefined, paddingHorizontal: 16, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <RNText style={tx('800', 21, t.colors.ink, { letterSpacing: -0.6 })}>
            taskdrop<RNText style={tx('800', 21, t.colors.accent)}>.</RNText>
          </RNText>
          <Tag label={TOUR_COPY.practice} />
        </View>
        {body}
      </View>
    </View>
  );
}

function Tag({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.colors.goldSoft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <RNText style={tx('800', 10, t.colors.goldInk, { letterSpacing: 0.8 })}>{label}</RNText>
    </View>
  );
}

function Card({ children, selected, dim }: { children: ReactNode; selected?: boolean; dim?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.colors.surface,
        borderRadius: 18,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.colors.accent : t.colors.line,
        padding: 12,
        marginBottom: 8,
        opacity: dim ? 0.45 : 1,
      }}
    >
      {children}
    </View>
  );
}

function Pill({ label, tone = 'btn' }: { label: string; tone?: 'btn' | 'quiet' }) {
  const t = useTheme();
  return (
    <View
      style={{
        minHeight: 50,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        backgroundColor: tone === 'btn' ? t.colors.btn : t.colors.surface,
        borderWidth: tone === 'btn' ? 0 : 1.5,
        borderColor: t.colors.line,
      }}
    >
      <RNText style={tx('800', 15, tone === 'btn' ? t.colors.onBtn : t.colors.ink)}>{label}</RNText>
    </View>
  );
}

function PostView({ practice }: { practice: Practice }) {
  const t = useTheme();
  const place = useTourTarget('postPlace');
  const button = useTourTarget('postButton');
  const chip = (label: string, on: boolean) => (
    <View
      style={{
        flex: 1,
        borderWidth: 1.5,
        borderColor: on ? t.colors.accent : t.colors.line,
        backgroundColor: on ? t.colors.accentSoft : 'transparent',
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: 'center',
      }}
    >
      <RNText style={tx('700', 13, on ? t.colors.accentDeep : t.colors.ink)}>{label}</RNText>
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>What do you need done?</RNText>
      <View style={{ borderWidth: 1.5, borderColor: t.colors.accent, borderRadius: 14, padding: 13, marginTop: 12 }}>
        <RNText style={tx('600', 15, t.colors.ink)}>{TASK}</RNText>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.colors.surface2, borderRadius: 14, padding: 13, marginTop: 10 }}>
        <RNText style={tx('600', 13.5, t.colors.text)}>Budget</RNText>
        <RNText style={tx('800', 15, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(OFFER)}</RNText>
      </View>
      <View ref={place} collapsable={false} style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {chip('At a place', Boolean(practice.placeChosen))}
        {chip('Remote / online', false)}
      </View>
      <View style={{ marginTop: 10, opacity: practice.placeChosen ? 1 : 0.5 }}>
        <RNText style={tx('500', 12, t.colors.muted)}>
          Workers see: <RNText style={tx('800', 12, t.colors.ink)}>Indiranagar, Bengaluru</RNText>
        </RNText>
      </View>
      <View style={{ flex: 1 }} />
      <View ref={button} collapsable={false}>
        <Pill label="Post" />
      </View>
    </View>
  );
}

function Offer({ name, price, presence, selected, dim, example = true }: { name: string; price: number; presence: string; selected?: boolean; dim?: boolean; example?: boolean }) {
  const t = useTheme();
  return (
    <Card selected={selected} dim={dim}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('800', 15, t.colors.onAccent)}>{name.charAt(0)}</RNText>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <RNText style={tx('700', 14, t.colors.ink)}>{name}</RNText>
            {example ? <Tag label={TOUR_COPY.example} /> : null}
          </View>
          <RNText style={tx('500', 11.5, t.colors.muted, { marginTop: 1 })}>{presence}</RNText>
        </View>
        <RNText style={tx('800', 16, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(price)}</RNText>
      </View>
    </Card>
  );
}

function OffersView({ practice, total }: { practice: Practice; total: number }) {
  const t = useTheme();
  const pick = useTourTarget('offerPick');
  const choose = useTourTarget('chooseButton');
  const picked = Boolean(practice.offerPicked);
  return (
    <View style={{ flex: 1 }}>
      <RNText style={tx('800', 11, t.colors.muted, { letterSpacing: 1.2, marginBottom: 8 })}>INCOMING OFFERS</RNText>
      <Offer name="Meera" price={650} presence="Active today" dim={picked} />
      <View ref={pick} collapsable={false}>
        <Offer name="Ravi" price={OFFER} presence="Active now" selected={picked} />
      </View>
      <Offer name="Sam" price={700} presence="Active now" dim={picked} />
      <View style={{ flex: 1 }} />
      {picked ? (
        <View ref={choose} collapsable={false}>
          <Pill label={`Choose offer · ${rupees(total)}`} />
        </View>
      ) : null}
    </View>
  );
}

function VaultView({ practice, path, fee, feePct }: { practice: Practice; path: TourPath; fee: number; feePct: number }) {
  const t = useTheme();
  const money = useTourTarget('vaultMoney');
  const action = useTourTarget('vaultAction');
  const payee = useTourTarget('payee');
  const paid = Boolean(practice.paid);
  const earn = path === 'earn';
  const row = (label: string, value: string, strong?: boolean) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: strong ? 0 : 1, borderBottomColor: t.colors.line }}>
      <RNText style={tx(strong ? '800' : '600', 13.5, strong ? t.colors.ink : t.colors.text)}>{label}</RNText>
      <RNText style={tx('800', strong ? 16 : 14, strong ? t.colors.accent : t.colors.ink, { fontVariant: ['tabular-nums'] })}>{value}</RNText>
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <View ref={money} collapsable={false}>
        <View style={{ alignItems: 'center', marginTop: 6 }}>
          <View style={{ width: 96, height: 96, borderRadius: 999, borderWidth: 8, borderColor: paid ? t.colors.line : t.colors.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: paid ? t.colors.accentSoft : t.colors.surface }}>
            <RNText style={tx('800', 34, paid ? t.colors.accent : t.colors.accentDeep)}>{paid ? '✓' : '🔒'}</RNText>
          </View>
          <RNText style={tx('800', 15, t.colors.ink, { marginTop: 10 })}>{paid ? 'Paid' : 'Held safely by TaskDrop'}</RNText>
        </View>
        <Card>
          {earn ? (
            <>
              {row('Priya’s payment, held', rupees(OFFER))}
              {row(paid ? 'Heading to your wallet' : 'Yours when she approves', rupees(OFFER), true)}
            </>
          ) : (
            <>
              {row('Ravi’s offer', rupees(OFFER))}
              {row(`Service fee ${Math.round(feePct * 100)}%`, rupees(fee))}
              {row('Held', rupees(OFFER + fee), true)}
            </>
          )}
        </Card>
      </View>
      <View ref={payee} collapsable={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('800', 15, t.colors.onAccent)}>{earn ? 'P' : 'R'}</RNText>
        </View>
        <View>
          <RNText style={tx('800', 14, t.colors.ink)}>{earn ? 'Priya' : 'Ravi'}</RNText>
          <RNText style={tx('600', 12, paid ? t.colors.accent : t.colors.muted)}>
            {paid ? (earn ? 'Paid to your wallet' : 'Paid') : earn ? 'Waiting for your work' : 'Says the work is done'}
          </RNText>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      {paid ? null : (
        <View ref={action} collapsable={false}>
          <Pill label={earn ? 'Mark as done' : 'Approve'} />
        </View>
      )}
    </View>
  );
}

function JobsView() {
  const t = useTheme();
  const job = useTourTarget('jobPick');
  const row = (title: string, sub: string, price: number, example?: boolean) => (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          {example ? <Tag label={TOUR_COPY.example} /> : null}
          <RNText style={tx('700', 13.5, t.colors.ink)}>{title}</RNText>
          <RNText style={tx('500', 11.5, t.colors.muted)}>{sub}</RNText>
        </View>
        <RNText style={tx('800', 14, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(price)}</RNText>
      </View>
    </Card>
  );
  return (
    <View>
      <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4, marginBottom: 10 })}>Work near you</RNText>
      <View ref={job} collapsable={false}>
        {row(TASK, 'Indiranagar · 1.2 km', OFFER, true)}
      </View>
      {row('Assemble a study table', 'HAL 2nd Stage · 2.0 km', 800)}
      <RNText style={tx('800', 15, t.colors.ink, { marginTop: 8 })}>Remote work</RNText>
      <RNText style={tx('400', 11.5, t.colors.muted, { marginBottom: 6 })}>Work you can do from your phone or laptop</RNText>
      {row('Translate a menu into Kannada', 'Remote', 900)}
    </View>
  );
}

function JobView() {
  const t = useTheme();
  const send = useTourTarget('sendOffer');
  return (
    <View style={{ flex: 1 }}>
      <Tag label={TOUR_COPY.example} />
      <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4, marginTop: 6 })}>{TASK}</RNText>
      <RNText style={tx('500', 13, t.colors.muted, { marginTop: 2 })}>Indiranagar · 1.2 km</RNText>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.colors.surface2, borderRadius: 14, padding: 13, marginTop: 14 }}>
        <RNText style={tx('600', 13.5, t.colors.text)}>Your offer</RNText>
        <RNText style={tx('800', 15, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(OFFER)}</RNText>
      </View>
      <View style={{ flex: 1 }} />
      <View ref={send} collapsable={false}>
        <Pill label="Send offer" />
      </View>
    </View>
  );
}

function AlertView() {
  const t = useTheme();
  const alert = useTourTarget('alert');
  return (
    <View ref={alert} collapsable={false}>
      <Card>
        <RNText style={tx('800', 13.5, t.colors.ink)}>Priya chose you</RNText>
        <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })}>{TASK}</RNText>
      </Card>
    </View>
  );
}

function ThreadView() {
  const t = useTheme();
  const address = useTourTarget('threadAddress');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ maxWidth: '78%', backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 16, borderBottomLeftRadius: 4, padding: 10 }}>
        <RNText style={tx('500', 13, t.colors.ink, { lineHeight: 18 })}>Hi! Can you come tomorrow morning?</RNText>
      </View>
      <View ref={address} collapsable={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <RNText style={tx('600', 13, t.colors.ink)}>🔒 Area: Indiranagar, Bengaluru</RNText>
      </View>
    </View>
  );
}

function TabsView({ path }: { path: TourPath }) {
  const t = useTheme();
  return (
    // In the middle, not at the bottom: the coach card sits over the bottom of the screen.
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 16, paddingVertical: 18 }}>
        {tourTabNames(path).map((name, i) => (
          <View key={name} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: i === 0 ? t.colors.accent : t.colors.line }} />
            <RNText style={tx('700', 10.5, i === 0 ? t.colors.accent : t.colors.muted, { marginTop: 4, textAlign: 'center' })} numberOfLines={1}>
              {name}
            </RNText>
          </View>
        ))}
      </View>
    </View>
  );
}
