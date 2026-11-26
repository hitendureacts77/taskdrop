import { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { TEMPLATES } from '../lib/taskBrief';
import { WHEN_WORDS, homeTemplates } from '../lib/homeTemplates';
import { FOR_YOU, IDEA_CHIPS, ideasIn, offerLine, type IdeaItem, type PosterIdea } from '../lib/homeIdeas';
import { firstOf } from '../lib/homeJobs';
import { useLayout } from '../lib/layout';
import { Icon } from './Icon';
import { Rail, useRailItemWidth } from './Rail';
import { IdeaTag, MeasuredGrid } from './HomeDesktop';
import { Chip, ChipFade, ChipRow } from './HomeLive';
import { HitArea, Pressy, tx } from './primitives';
import { cardSurface } from './ui';

/**
 * "Ideas to post" on Hire Home (task 1.19 F, decision 1): one block with chips instead of Quick templates, Idea
 * templates for you and the nine "manage your tasks" tiles. The phone shows four cards, the desktop one row of three; every
 * chip's other cards sit behind "Show N more", and "See all" opens Explore's list (Ideas), which holds them all.
 */
export function IdeasToPost({ onPick, onSeeAll }: { onPick: (x: IdeaItem) => void; onSeeAll: () => void }) {
  const t = useTheme();
  const { desktop, tablet } = useLayout();
  const [chip, setChip] = useState(FOR_YOU);
  const [open, setOpen] = useState(false);
  const all = ideasIn(chip, homeTemplates(TEMPLATES));
  // Desktop: one row (three cards); the rest wait behind Show more (task 1.19 R).
  const first = desktop ? 3 : 4;
  const { shown, extra } = firstOf(all, first, open);
  const pick = (c: string) => {
    setChip(c);
    setOpen(false);
  };
  const tiles = shown.map((x) => <IdeaTile key={x.key} item={x} onPress={() => onPick(x)} />);
  return (
    <View testID="home-templates" style={{ marginTop: 32 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <RNText accessibilityRole="header" style={tx('800', 18, t.colors.ink, { letterSpacing: -0.35, flex: 1 })}>
          Ideas to post
        </RNText>
        <Pressable onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all ideas" hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <HitArea x={8} y={12} />
          <RNText style={tx('700', 13, t.colors.accentDeep)}>See all ›</RNText>
        </Pressable>
      </View>
      <ChipRow>
        {IDEA_CHIPS.map((c) => (
          <Chip key={c} label={c} on={c === chip} onPress={() => pick(c)} />
        ))}
      </ChipRow>
      <ChipFade chip={chip}>
        <View style={{ marginTop: 12 }}>
          {desktop || tablet ? (
            <MeasuredGrid min={190} gap={12}>
              {tiles}
            </MeasuredGrid>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {shown.map((x) => (
                <View key={x.key} style={{ flexGrow: 1, flexBasis: '40%', maxWidth: '50%' }}>
                  <IdeaTile item={x} onPress={() => onPick(x)} />
                </View>
              ))}
            </View>
          )}
          {extra > 0 ? (
            <Pressable
              onPress={() => setOpen((v) => !v)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                marginTop: 10,
                alignSelf: 'center',
                paddingVertical: 8,
                paddingHorizontal: 16,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.colors.line,
                backgroundColor: t.colors.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <RNText style={tx('700', 12.5, t.colors.accentDeep)}>{open ? 'Show less' : `Show ${extra} more`}</RNText>
            </Pressable>
          ) : null}
        </View>
      </ChipFade>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10, lineHeight: 17 })}>
        {desktop
          ? 'Just ideas, not services from TaskDrop. Click one and it fills your post; you set the price and pick who does it.'
          : 'Just ideas, not services from TaskDrop. Tap one and it fills your post; you set the price and pick who does it.'}
      </RNText>
    </View>
  );
}

/** One card of Ideas to post: the icon, the idea, one line, and what people often offer (or the day it fills in). */
function IdeaTile({ item: x, onPress }: { item: IdeaItem; onPress: () => void }) {
  const t = useTheme();
  const foot = x.price ? offerLine(x.price) : x.when ? `Day: ${WHEN_WORDS[x.when]}` : null;
  const label =
    x.kind === 'template'
      ? `${x.title}. ${x.sub ?? ''}. Day filled in: ${x.when ? WHEN_WORDS[x.when] : ''}. Opens the new task screen`
      : `${x.title}. Idea. ${x.sub ?? ''}${x.price ? ` People often offer ${offerLine(x.price)}.` : ''} Post this idea`;
  return (
    <Pressy
      testID={x.templateKey ? `home-template-${x.templateKey}` : undefined}
      onPress={onPress}
      scaleTo={0.97}
      label={label}
      style={[cardSurface(t, 16), { flex: 1, minHeight: 132, padding: 12, gap: 6 }]}
    >
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={x.icon} size={17} color={t.colors.accentDeep} />
      </View>
      <RNText style={tx('800', 14, t.colors.ink, { lineHeight: 18 })} numberOfLines={2}>
        {x.title}
      </RNText>
      {x.sub ? (
        <RNText style={tx('500', 12, t.colors.muted, { lineHeight: 16 })} numberOfLines={2}>
          {x.sub}
        </RNText>
      ) : null}
      <View style={{ flexGrow: 1 }} />
      {foot ? <RNText style={tx('800', 13, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{foot}</RNText> : null}
    </Pressy>
  );
}

/** One idea card with its price and button (Earn's Ways to earn). A component so it can read the Rail's width. */
function IdeaCard({
  idea: x,
  onPress,
  priceLabel = 'People often offer',
  cta = 'Post this idea',
  hidePrice = false,
  dashed = false,
  testID,
}: {
  idea: PosterIdea;
  onPress: () => void;
  priceLabel?: string;
  cta?: string;
  /** The Add skill card has no price to show. */
  hidePrice?: boolean;
  dashed?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const { desktop, tablet } = useLayout();
  const railWidth = useRailItemWidth(230);
  // Desktop: the Rail's grid width; tablets keep the 230 they always had; the phone rail is narrower (Ways to earn).
  const width = desktop ? railWidth : tablet ? 230 : 176;
  return (
    <Pressy
      testID={testID}
      onPress={onPress}
      scaleTo={0.97}
      label={hidePrice ? `${x.title}. ${x.problem} ${cta}` : `${x.title}. Idea. ${x.problem} ${priceLabel} ${offerLine(x.price)}. ${cta}`}
      style={[cardSurface(t, 16), { width, padding: 12, gap: 8 }, dashed ? { borderStyle: 'dashed', borderColor: t.colors.accentBorder } : null]}
    >
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={x.icon} size={17} color={t.colors.accentDeep} />
      </View>
      <RNText style={tx('800', 14, t.colors.ink, { lineHeight: 18 })} numberOfLines={2}>
        {x.title}
      </RNText>
      <RNText style={tx('500', 12, t.colors.muted, { lineHeight: 17 })} numberOfLines={3}>
        {x.problem}
      </RNText>
      <View style={{ flexGrow: 1 }} />
      {hidePrice ? null : (
        <View>
          <RNText style={tx('700', 10, t.colors.muted, { letterSpacing: 0.8 })}>{priceLabel.toUpperCase()}</RNText>
          <RNText style={tx('800', 14, t.colors.ink, { marginTop: 2, fontVariant: ['tabular-nums'] })}>{offerLine(x.price)}</RNText>
        </View>
      )}
      <View style={{ height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentSoft }}>
        <RNText style={tx('800', 12.5, t.colors.accentDeep)}>{cta} ›</RNText>
      </View>
    </Pressy>
  );
}

// Ways to earn (D31 boards, Earn Home): kinds of work people post on TaskDrop, the worker's side of the poster ideas,
// with the same typical prices. Static idea content: no counts, no live jobs claimed. Each opens Find work searched
// for that kind of job (the search may well find none open today).
const EARN_IDEAS: (PosterIdea & { search: string })[] = [
  { icon: 'camera', title: 'Shoot product photos', problem: 'Small sellers need photos that sell on Instagram, Meesho or Amazon.', price: 'from ₹1,500', prompt: '', search: 'photos' },
  { icon: 'wallet', title: 'Chase a stuck claim', problem: 'PF and insurance claims that need papers filed and follow-ups.', price: 'from ₹800', prompt: '', search: 'claim' },
  { icon: 'wrench', title: 'Weekly site visits', problem: 'Count the material and send photos of a house being built.', price: '₹700 a visit', prompt: '', search: 'site' },
  { icon: 'heart', title: 'Hospital runner', problem: 'Billing, insurance desk and medicines while the family stays by the bed.', price: '₹1,500 a day', prompt: '', search: 'hospital' },
  { icon: 'compass', title: 'Flat hunting tours', problem: 'Shortlist, visit and video tour flats for someone moving to your city.', price: 'from ₹1,500', prompt: '', search: 'flat' },
  { icon: 'globe', title: 'Put a shop online', problem: 'Google Maps, food apps and a WhatsApp catalogue for a local shop.', price: 'from ₹2,000', prompt: '', search: 'shop' },
];

/** D32: the last card opens Edit skills. No price, so none is shown. */
const ADD_SKILL: PosterIdea = { icon: 'star', title: 'Add a skill', problem: 'Tell us what you can do and see jobs that match.', price: '', prompt: '' };

/**
 * "Ways to earn" (Earn Home, task 1.19 F): a rail of the kinds of work people post, each leading to Find work searched
 * for that kind of job, and "Add a skill" last. Royal blue: Earn's accent tokens.
 */
export function WaysToEarn({ onSearch, onAddSkill }: { onSearch: (q: string) => void; onAddSkill: () => void }) {
  const t = useTheme();
  const { desktop, tablet } = useLayout();
  const cards = [
    ...EARN_IDEAS.map((x) => (
      <IdeaCard key={x.title} idea={x} onPress={() => onSearch(x.search)} priceLabel="People often pay" cta="Find jobs like this" />
    )),
    <IdeaCard key="add-skill" testID="home-add-skill" idea={ADD_SKILL} onPress={onAddSkill} hidePrice cta="Add to my skills" dashed />,
  ];
  return (
    <View testID="home-earn-templates" style={{ marginTop: 32 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <RNText accessibilityRole="header" style={tx('800', 18, t.colors.ink, { letterSpacing: -0.35, flex: 1 })}>
          Ways to earn
        </RNText>
        <IdeaTag plural />
      </View>
      <View style={{ marginTop: 12 }}>
        {desktop || tablet ? (
          <Rail min={desktop ? 170 : 220} rows={1}>{cards}</Rail>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
            {cards}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
