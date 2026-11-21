import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, Text as RNText, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { LOOP_NATIVE, useReducedMotion } from '../lib/motion';
import type { Theme } from '../theme';
import { Icon, type IconName } from './Icon';
import { tx } from './primitives';
import { Drop } from './Ripples';

const BEAT_MS = 4200;
/** Every scene is drawn on this canvas, which fits the narrowest phone (320 wide). */
const W = 280;
const H = 226;
const BAR = 40;

const HIRE_BEATS = [
  { key: 'ask', title: 'Ask for anything', body: 'Say what you need in plain words. We write the post for you.' },
  { key: 'offers', title: 'Offers come to you', body: 'People nearby, or online from anywhere, send you their price.' },
  { key: 'held', title: 'Your money stays safe', body: 'Pick the offer you like. TaskDrop holds the money while the work gets done.' },
  { key: 'paid', title: 'Approve, and they get paid', body: 'Happy with the work? Release the payment and leave a rating.' },
  { key: 'both', title: 'Need help or want to earn?', body: 'One account does both. Switch to Earn, find tasks and send your own offers.' },
] as const;

/**
 * The same story for someone who opened it from Earn home: finding work,
 * sending a price, the money held first, doing the work, getting paid, then
 * the way back to hiring. Same player, the earn parts.
 */
const EARN_BEATS = [
  { key: 'jobs', title: 'Find work near you', body: 'Jobs in your area, or online from anywhere. Pick one you can do.' },
  { key: 'offer', title: 'Send your price', body: 'Say what you charge and why you. The customer compares offers.' },
  { key: 'earnHeld', title: 'The money is there first', body: 'When they accept, they pay. TaskDrop holds it while you work.' },
  { key: 'earnWork', title: 'Do it, show it', body: 'Swipe to start, do the job, send before and after photos.' },
  { key: 'earnPaid', title: 'Approved, and you are paid', body: 'The money reaches your wallet. Withdraw to UPI or bank.' },
  { key: 'both', title: 'Need help too?', body: 'One account does both. Switch to Hire and ask for anything.' },
] as const;

type Beat = (typeof HIRE_BEATS)[number]['key'] | (typeof EARN_BEATS)[number]['key'];
type Scene = { p: Animated.Value; t: Theme };

// All of it runs on one 0..1 clock per beat. Eased by hand with extra stops,
// because the native driver ignores an easing on an interpolation.
const fade = (p: Animated.Value, a: number, b: number) =>
  p.interpolate({ inputRange: [a, b], outputRange: [0, 1], extrapolate: 'clamp' });

/** Comes in fast, slows to a stop. */
const glide = (p: Animated.Value, a: number, b: number, from: number, to: number) =>
  p.interpolate({
    inputRange: [a, a + (b - a) * 0.5, b],
    outputRange: [from, from + (to - from) * 0.82, to],
    extrapolate: 'clamp',
  });

/** Grows a little past its size, then settles. */
const pop = (p: Animated.Value, a: number, b: number) =>
  p.interpolate({ inputRange: [a, a + (b - a) * 0.65, b], outputRange: [0.4, 1.12, 1], extrapolate: 'clamp' });

const place = (left: number, top: number, extra?: ViewStyle): ViewStyle => ({ position: 'absolute', left, top, ...extra });

function Person({ name, tint, ink, size = 40 }: { name: string; tint: string; ink: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
      <RNText style={tx('800', size * 0.42, ink)}>{name[0]}</RNText>
    </View>
  );
}

function Tag({ label, tint, ink }: { label: string; tint: string; ink: string }) {
  return (
    <View style={{ backgroundColor: tint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
      <RNText style={tx('700', 10.5, ink)}>{label}</RNText>
    </View>
  );
}

function OfferRow({ t, name, tag, tagTint, tagInk, price, picked }: { t: Theme; name: string; tag: string; tagTint: string; tagInk: string; price: string; picked?: boolean }) {
  const c = t.colors;
  return (
    <View
      style={{
        height: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        borderRadius: 18,
        backgroundColor: c.surface,
        borderWidth: 1.5,
        borderColor: picked ? c.accent : c.line,
      }}
    >
      <Person name={name} tint={tagTint} ink={tagInk} />
      <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
        <RNText style={tx('700', 14, c.ink)}>{name}</RNText>
        <Tag label={tag} tint={tagTint} ink={tagInk} />
      </View>
      <RNText style={tx('800', 16, c.ink, { fontVariant: ['tabular-nums'] })}>{price}</RNText>
      {picked ? (
        <View style={{ width: 22, height: 22, borderRadius: 22, backgroundColor: c.btn, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={13} color={c.onBtn} strokeWidth={3} />
        </View>
      ) : null}
    </View>
  );
}

function Coin({ t }: { t: Theme }) {
  return (
    <View style={{ width: 32, height: 32, borderRadius: 32, backgroundColor: t.colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: t.colors.surface }}>
      <RNText style={tx('800', 15, '#3A2506')}>₹</RNText>
    </View>
  );
}

/** Line of dots a coin travels along. */
function Trail({ left, top, t }: { left: number; top: number; t: Theme }) {
  return (
    <View style={place(left, top, { flexDirection: 'row', gap: 5 })}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ width: 4, height: 4, borderRadius: 4, backgroundColor: t.colors.muted, opacity: 0.45 }} />
      ))}
    </View>
  );
}

const NODE_Y = 138;
const X_YOU = 34;
const X_SAFE = 140;
const X_HELPER = 246;

/** You, TaskDrop in the middle, the helper: the same stage for "held" and "paid". */
function MoneyPath({ t, you, safe, helper, safeLabel }: { t: Theme; you?: ReactNode; safe?: ReactNode; helper?: ReactNode; safeLabel: ReactNode }) {
  const c = t.colors;
  const label = (text: string, x: number) => (
    <RNText style={[place(x - 40, NODE_Y + 34, { width: 80 }), tx('600', 11.5, c.muted, { textAlign: 'center' })]}>{text}</RNText>
  );
  return (
    <>
      <Trail left={X_YOU + 28} top={NODE_Y - 2} t={t} />
      <Trail left={X_SAFE + 38} top={NODE_Y - 2} t={t} />
      <View style={place(X_YOU - 24, NODE_Y - 24)}>
        {you ?? (
          <View style={{ width: 48, height: 48, borderRadius: 48, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="wallet" size={21} color={c.accentDeep} />
          </View>
        )}
      </View>
      <View style={place(X_SAFE - 34, NODE_Y - 34)}>{safe}</View>
      <View style={place(X_HELPER - 24, NODE_Y - 24)}>{helper ?? <Person name="Asha" tint={c.purpleSoft} ink={c.purpleDeep} size={48} />}</View>
      {label('You', X_YOU)}
      {label('Asha', X_HELPER)}
      <View style={place(X_SAFE - 56, NODE_Y + 42, { width: 112, alignItems: 'center' })}>{safeLabel}</View>
    </>
  );
}

function Shield({ t }: { t: Theme }) {
  const c = t.colors;
  return (
    <View style={{ width: 68, height: 68, borderRadius: 68, backgroundColor: c.accentSoft, borderWidth: 2, borderColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="shield" size={32} color={c.accentDeep} />
    </View>
  );
}

function SceneAsk({ p, t }: Scene) {
  const c = t.colors;
  const landAt = 0.6;
  const send = p.interpolate({ inputRange: [0.46, 0.5, 0.55], outputRange: [1, 0.82, 1], extrapolate: 'clamp' });
  return (
    <>
      {[0, 0.08, 0.16].map((d) => (
        <Animated.View
          key={d}
          style={[
            place(W / 2 - 62, 8, { width: 124, height: 124, borderRadius: 124, borderWidth: 2, borderColor: c.accent }),
            {
              opacity: p.interpolate({ inputRange: [landAt + d, landAt + d + 0.01, landAt + d + 0.24], outputRange: [0, 0.6, 0], extrapolate: 'clamp' }),
              transform: [{ scale: glide(p, landAt + d, landAt + d + 0.24, 0.2, 1) }],
            },
          ]}
        />
      ))}
      <Animated.View
        style={[
          place(W / 2 - 28, 42),
          {
            opacity: fade(p, 0.5, 0.53),
            transform: [
              { translateY: p.interpolate({ inputRange: [0.5, landAt], outputRange: [-120, 0], extrapolate: 'clamp' }) },
              // The bump when it lands.
              { scaleY: p.interpolate({ inputRange: [landAt - 0.01, landAt + 0.03, landAt + 0.09], outputRange: [1, 0.8, 1], extrapolate: 'clamp' }) },
              { scaleX: p.interpolate({ inputRange: [landAt - 0.01, landAt + 0.03, landAt + 0.09], outputRange: [1, 1.14, 1], extrapolate: 'clamp' }) },
            ],
          },
        ]}
      >
        <Drop size={56} fill={c.accent} tick={c.onAccent} />
      </Animated.View>
      <Animated.View
        style={[
          place(0, 150, {
            width: W,
            height: 62,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 12,
            borderRadius: 20,
            backgroundColor: c.surface,
            borderWidth: 1.5,
            borderColor: c.accentBorder,
          }),
          { opacity: fade(p, 0.02, 0.08), transform: [{ translateY: glide(p, 0.02, 0.1, 18, 0) }] },
        ]}
      >
        <Icon name="sparkle" size={18} color={c.ai} />
        <View style={{ flex: 1, height: 20, overflow: 'hidden', justifyContent: 'center' }}>
          <RNText numberOfLines={1} style={tx('600', 13.5, c.ink)}>
            Set up my new laptop
          </RNText>
          {/* Typing: a cover slides off the sentence, with the cursor on its edge. */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: 190,
              backgroundColor: c.surface,
              transform: [{ translateX: p.interpolate({ inputRange: [0.1, 0.46], outputRange: [0, 190], extrapolate: 'clamp' }) }],
            }}
          >
            <Animated.View style={{ position: 'absolute', left: 0, top: 1, bottom: 1, width: 2, backgroundColor: c.accent, opacity: p.interpolate({ inputRange: [0.34, 0.38], outputRange: [1, 0], extrapolate: 'clamp' }) }} />
          </Animated.View>
        </View>
        <Animated.View style={{ width: 36, height: 36, borderRadius: 36, backgroundColor: c.btn, alignItems: 'center', justifyContent: 'center', transform: [{ scale: send }] }}>
          <Icon name="send" size={17} color={c.onBtn} />
        </Animated.View>
      </Animated.View>
    </>
  );
}

function SceneOffers({ p, t }: Scene) {
  const c = t.colors;
  const offers = [
    { name: 'Asha', tag: 'Nearby', tagTint: c.accentSoft, tagInk: c.accentDeep, price: '₹450', at: 0.06, from: 46 },
    { name: 'Ravi', tag: 'Online', tagTint: c.purpleSoft, tagInk: c.purpleDeep, price: '₹500', at: 0.24, from: -46 },
    { name: 'Meera', tag: 'Nearby', tagTint: c.goldSoft, tagInk: c.goldInk, price: '₹400', at: 0.42, from: 46 },
  ];
  return (
    <>
      {offers.map((o, i) => (
        <Animated.View
          key={o.name}
          style={[
            place(0, 4 + i * 74, { width: W }),
            { opacity: fade(p, o.at, o.at + 0.1), transform: [{ translateX: glide(p, o.at, o.at + 0.16, o.from, 0) }] },
          ]}
        >
          <OfferRow t={t} {...o} />
        </Animated.View>
      ))}
    </>
  );
}

function SceneHeld({ p, t }: Scene) {
  const c = t.colors;
  const hit = 0.5;
  return (
    <>
      <Animated.View style={[place(0, 4, { width: W }), { transform: [{ scale: pop(p, 0.03, 0.16) }] }]}>
        <OfferRow t={t} name="Asha" tag="Nearby" tagTint={c.accentSoft} tagInk={c.accentDeep} price="₹450" picked />
      </Animated.View>
      <Animated.View style={{ opacity: fade(p, 0.1, 0.2) }}>
        <MoneyPath
          t={t}
          safe={
            <Animated.View style={{ transform: [{ scale: p.interpolate({ inputRange: [hit, hit + 0.06, hit + 0.14], outputRange: [1, 1.14, 1], extrapolate: 'clamp' }) }] }}>
              <Shield t={t} />
              <Animated.View
                style={[
                  place(46, 44, { width: 26, height: 26, borderRadius: 26, backgroundColor: c.btn, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.surface2 }),
                  { opacity: fade(p, hit + 0.04, hit + 0.08), transform: [{ scale: pop(p, hit + 0.04, hit + 0.16) }] },
                ]}
              >
                <Icon name="lock" size={12} color={c.onBtn} strokeWidth={2.4} />
              </Animated.View>
            </Animated.View>
          }
          safeLabel={
            <Animated.View style={{ opacity: fade(p, hit + 0.08, hit + 0.18) }}>
              <Tag label="₹450 held safely" tint={c.accentSoft} ink={c.accentDeep} />
            </Animated.View>
          }
        />
      </Animated.View>
      <Animated.View
        style={[
          place(X_YOU - 16, NODE_Y - 16),
          {
            opacity: p.interpolate({ inputRange: [0.2, 0.24, hit - 0.02, hit], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [
              { translateX: p.interpolate({ inputRange: [0.24, hit], outputRange: [0, X_SAFE - X_YOU], extrapolate: 'clamp' }) },
              { translateY: p.interpolate({ inputRange: [0.24, 0.37, hit], outputRange: [0, -22, 0], extrapolate: 'clamp' }) },
            ],
          },
        ]}
      >
        <Coin t={t} />
      </Animated.View>
    </>
  );
}

function ScenePaid({ p, t }: Scene) {
  const c = t.colors;
  const leave = 0.34;
  const arrive = 0.6;
  const approve = p.interpolate({ inputRange: [0.24, 0.28, 0.33], outputRange: [1, 0.86, 1], extrapolate: 'clamp' });
  return (
    <>
      <View
        style={place(0, 4, {
          width: W,
          height: 64,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 12,
          borderRadius: 18,
          backgroundColor: c.surface,
          borderWidth: 1.5,
          borderColor: c.line,
        })}
      >
        <Animated.View style={{ transform: [{ scale: pop(p, 0.04, 0.18) }] }}>
          <View style={{ width: 36, height: 36, borderRadius: 36, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={19} color={c.accentDeep} strokeWidth={2.8} />
          </View>
        </Animated.View>
        <View style={{ flex: 1 }}>
          <RNText style={tx('700', 14, c.ink)}>Work done</RNText>
          <RNText style={tx('400', 12, c.muted, { marginTop: 1 })}>Laptop is ready</RNText>
        </View>
        <Animated.View style={{ backgroundColor: c.btn, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, transform: [{ scale: approve }] }}>
          <RNText style={tx('700', 12, c.onBtn)}>Approve</RNText>
        </Animated.View>
      </View>
      <MoneyPath
        t={t}
        safe={<Shield t={t} />}
        helper={
          <Animated.View style={{ transform: [{ scale: p.interpolate({ inputRange: [arrive, arrive + 0.06, arrive + 0.14], outputRange: [1, 1.18, 1], extrapolate: 'clamp' }) }] }}>
            <Person name="Asha" tint={c.purpleSoft} ink={c.purpleDeep} size={48} />
          </Animated.View>
        }
        safeLabel={
          <View style={{ flexDirection: 'row', gap: 3 }}>
            {[0, 1, 2, 3, 4].map((i) => {
              const at = arrive + 0.04 + i * 0.04;
              return (
                <Animated.View key={i} style={{ opacity: fade(p, at, at + 0.02), transform: [{ scale: pop(p, at, at + 0.1) }] }}>
                  <Icon name="star" size={16} color={c.gold} />
                </Animated.View>
              );
            })}
          </View>
        }
      />
      <Animated.View
        style={[
          place(X_SAFE - 16, NODE_Y - 16),
          {
            opacity: p.interpolate({ inputRange: [leave - 0.04, leave, arrive - 0.02, arrive], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [
              { translateX: p.interpolate({ inputRange: [leave, arrive], outputRange: [0, X_HELPER - X_SAFE], extrapolate: 'clamp' }) },
              { translateY: p.interpolate({ inputRange: [leave, (leave + arrive) / 2, arrive], outputRange: [0, -22, 0], extrapolate: 'clamp' }) },
            ],
          },
        ]}
      >
        <Coin t={t} />
      </Animated.View>
      <Animated.View style={[place(X_HELPER - 30, NODE_Y - 46, { width: 60, alignItems: 'center' }), { opacity: fade(p, arrive, arrive + 0.05) }]}>
        <Tag label="Paid" tint={c.purpleSoft} ink={c.purpleDeep} />
      </Animated.View>
    </>
  );
}

// The earn story ends on the same switch, going the other way: Earn, then Hire.
function SceneBoth({ p, t, rev }: Scene & { rev?: boolean }) {
  const c = t.colors;
  const flip = 0.36;
  const after = fade(p, flip, flip + 0.1);
  const before = p.interpolate({ inputRange: [flip, flip + 0.1], outputRange: [1, 0], extrapolate: 'clamp' });
  const toEarn = rev ? before : after;
  const toHire = rev ? after : before;
  const KNOB = 92;
  const label = (text: string, icon: IconName, left: number, onKnob: Animated.AnimatedInterpolation<number>) => (
    <View style={place(left, 0, { width: KNOB, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 })}>
      <Icon name={icon} size={15} color={c.muted} />
      <RNText style={tx('700', 13.5, c.muted)}>{text}</RNText>
      <Animated.View style={{ position: 'absolute', inset: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: onKnob }}>
        <Icon name={icon} size={15} color="#FFFFFF" />
        <RNText style={tx('700', 13.5, '#FFFFFF')}>{text}</RNText>
      </Animated.View>
    </View>
  );
  const row = (title: string, tag: string, price: string, top: number, at: number) => (
    <Animated.View
      style={[
        place(0, top, { width: W, height: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.line }),
        { opacity: fade(p, at, at + 0.08), transform: [{ translateY: glide(p, at, at + 0.14, 16, 0) }] },
      ]}
    >
      <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
        <RNText numberOfLines={1} style={tx('700', 13.5, c.ink)}>
          {title}
        </RNText>
        <Tag label={tag} tint={c.purpleSoft} ink={c.purpleDeep} />
      </View>
      <RNText style={tx('800', 15, c.ink, { fontVariant: ['tabular-nums'] })}>{price}</RNText>
    </Animated.View>
  );
  return (
    <>
      <View style={place((W - 192) / 2, 6, { width: 192, height: 52, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line })}>
        <View style={{ position: 'absolute', left: 3, top: 3, width: 184, height: 44 }}>
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: KNOB,
              height: 44,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: c.hero,
              transform: [{ translateX: rev ? glide(p, flip, flip + 0.12, KNOB, 0) : glide(p, flip, flip + 0.12, 0, KNOB) }],
            }}
          >
            <Animated.View style={{ position: 'absolute', inset: 0, backgroundColor: c.purpleFill, opacity: toEarn }} />
          </Animated.View>
          {label('Hire', 'briefcase', 0, toHire)}
          {label('Earn', 'wallet', KNOB, toEarn)}
        </View>
      </View>
      {/* Hire side: your request and its offers. */}
      <Animated.View
        style={[
          place(0, 76, { width: W, height: 74, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.accentBorder }),
          rev
            ? { opacity: fade(p, flip + 0.1, flip + 0.18), transform: [{ translateY: glide(p, flip + 0.1, flip + 0.2, 12, 0) }] }
            : { opacity: toHire, transform: [{ translateY: glide(p, flip, flip + 0.1, 0, -12) }] },
        ]}
      >
        <Drop size={34} fill={c.accent} tick={c.onAccent} />
        <View style={{ flex: 1, gap: 2 }}>
          <RNText numberOfLines={1} style={tx('700', 14, c.ink)}>
            Set up my new laptop
          </RNText>
          <RNText style={tx('600', 12, c.accentDeep)}>3 offers waiting</RNText>
        </View>
      </Animated.View>
      {/* Earn side: tasks to send an offer on, near you and online. */}
      {rev ? (
        <>
          <Animated.View style={{ opacity: toEarn }}>{row('Design a shop poster', 'Online', '₹800', 76, 0)}</Animated.View>
          <Animated.View style={{ opacity: toEarn }}>{row('Help move a sofa', 'Nearby', '₹600', 142, 0)}</Animated.View>
        </>
      ) : (
        <>
          {row('Design a shop poster', 'Online', '₹800', 76, flip + 0.1)}
          {row('Help move a sofa', 'Nearby', '₹600', 142, flip + 0.2)}
        </>
      )}
    </>
  );
}

/** Earn 1: jobs near you and online slide in, one is picked out. */
function SceneJobs({ p, t }: Scene) {
  const c = t.colors;
  const jobs = [
    { title: 'Design a shop poster', tag: 'Online', price: '₹800', at: 0.06, from: 46 },
    { title: 'Help move a sofa', tag: 'Nearby', price: '₹600', at: 0.24, from: -46 },
    { title: 'Fix a leaking tap', tag: 'Nearby', price: '₹350', at: 0.42, from: 46 },
  ];
  return (
    <>
      {jobs.map((j, i) => (
        <Animated.View
          key={j.title}
          style={[
            place(0, 4 + i * 74, { width: W, height: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1.5, borderColor: i === 1 ? c.accent : c.line }),
            { opacity: fade(p, j.at, j.at + 0.1), transform: [{ translateX: glide(p, j.at, j.at + 0.16, j.from, 0) }] },
          ]}
        >
          <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
            <RNText numberOfLines={1} style={tx('700', 14, c.ink)}>{j.title}</RNText>
            <Tag label={j.tag} tint={c.purpleSoft} ink={c.purpleDeep} />
          </View>
          <RNText style={tx('800', 16, c.ink, { fontVariant: ['tabular-nums'] })}>{j.price}</RNText>
        </Animated.View>
      ))}
    </>
  );
}

/** Earn 2: your price goes in a card and is sent. */
function SceneOffer({ p, t }: Scene) {
  const c = t.colors;
  const press = p.interpolate({ inputRange: [0.5, 0.55, 0.6], outputRange: [1, 0.86, 1], extrapolate: 'clamp' });
  return (
    <>
      <Animated.View
        style={[
          place(0, 14, { width: W, padding: 14, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.accentBorder, gap: 10 }),
          { opacity: fade(p, 0.02, 0.1), transform: [{ translateY: glide(p, 0.02, 0.12, 18, 0) }] },
        ]}
      >
        <RNText style={tx('700', 12, c.muted)}>Your price</RNText>
        <RNText style={tx('800', 28, c.ink, { fontVariant: ['tabular-nums'] })}>₹450</RNText>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: c.line, width: '86%' }} />
        <View style={{ height: 8, borderRadius: 4, backgroundColor: c.line, width: '62%' }} />
      </Animated.View>
      <Animated.View style={[place(W - 112, 168, { backgroundColor: c.btn, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 }), { opacity: fade(p, 0.2, 0.28), transform: [{ scale: press }] }]}>
        <RNText style={tx('800', 13, c.onBtn)}>Send offer</RNText>
      </Animated.View>
      <Animated.View style={[place(0, 174), { opacity: fade(p, 0.62, 0.7) }]}>
        <Tag label="Offer sent" tint={c.purpleSoft} ink={c.purpleDeep} />
      </Animated.View>
    </>
  );
}

/** Earn 3: the customer has paid, and the shield holds it. */
function SceneEarnHeld({ p, t }: Scene) {
  const c = t.colors;
  return (
    <>
      <Animated.View style={[place(0, 4, { width: W }), { transform: [{ scale: pop(p, 0.03, 0.16) }] }]}>
        <OfferRow t={t} name="Meera" tag="Accepted" tagTint={c.purpleSoft} tagInk={c.purpleDeep} price="Paid" picked />
      </Animated.View>
      <Animated.View style={[place(W / 2 - 34, 92), { opacity: fade(p, 0.22, 0.32), transform: [{ scale: pop(p, 0.22, 0.4) }] }]}>
        <Shield t={t} />
      </Animated.View>
      <Animated.View style={[place(W / 2 - 60, 170, { width: 120, alignItems: 'center' }), { opacity: fade(p, 0.45, 0.55) }]}>
        <Tag label="Held safely" tint={c.purpleSoft} ink={c.purpleDeep} />
      </Animated.View>
    </>
  );
}

/** Earn 4: swipe to start, then the before and after photos. */
function SceneEarnWork({ p, t }: Scene) {
  const c = t.colors;
  const TRACK = 220;
  const photo = (left: number, label: string, at: number) => (
    <Animated.View
      style={[
        place(left, 112, { width: 128, height: 84, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center', gap: 6 }),
        { opacity: fade(p, at, at + 0.08), transform: [{ scale: pop(p, at, at + 0.16) }] },
      ]}
    >
      <Icon name="camera" size={24} color={c.purpleDeep} />
      <RNText style={tx('700', 12, c.muted)}>{label}</RNText>
    </Animated.View>
  );
  return (
    <>
      <View style={place((W - TRACK) / 2, 14, { width: TRACK, height: 52, borderRadius: 999, backgroundColor: c.purpleSoft, borderWidth: 1, borderColor: c.line, justifyContent: 'center' })}>
        <RNText style={[tx('700', 13, c.purpleDeep, { textAlign: 'center' }), { paddingLeft: 40 }]}>Swipe to start</RNText>
        <Animated.View
          style={[
            place(4, 4, { width: 44, height: 44, borderRadius: 44, backgroundColor: c.purpleFill, alignItems: 'center', justifyContent: 'center' }),
            { transform: [{ translateX: glide(p, 0.1, 0.3, 0, TRACK - 52) }] },
          ]}
        >
          <Icon name="chevronRight" size={20} color="#FFFFFF" />
        </Animated.View>
      </View>
      {photo(8, 'Before', 0.4)}
      {photo(W - 136, 'After', 0.58)}
    </>
  );
}

/** Earn 5: approved, and the money lands in the wallet. */
function SceneEarnPaid({ p, t }: Scene) {
  const c = t.colors;
  return (
    <>
      <Animated.View style={[place(W / 2 - 40, 52, { width: 80, height: 80, borderRadius: 80, backgroundColor: c.purpleSoft, borderWidth: 2, borderColor: c.accent, alignItems: 'center', justifyContent: 'center' }), { transform: [{ scale: p.interpolate({ inputRange: [0.5, 0.56, 0.64], outputRange: [1, 1.14, 1], extrapolate: 'clamp' }) }] }]}>
        <Icon name="wallet" size={34} color={c.purpleDeep} />
      </Animated.View>
      <Animated.View
        style={[
          place(W / 2 - 16, 0),
          {
            opacity: p.interpolate({ inputRange: [0.1, 0.16, 0.48, 0.52], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [{ translateY: glide(p, 0.16, 0.5, 0, 74) }],
          },
        ]}
      >
        <Coin t={t} />
      </Animated.View>
      <Animated.View style={[place(W / 2 - 60, 146, { width: 120, alignItems: 'center' }), { opacity: fade(p, 0.52, 0.6) }]}>
        <Tag label="Paid" tint={c.purpleSoft} ink={c.purpleDeep} />
      </Animated.View>
      <View style={place(W / 2 - 50, 178, { width: 100, flexDirection: 'row', justifyContent: 'center', gap: 3 })}>
        {[0, 1, 2, 3, 4].map((i) => {
          const at = 0.6 + i * 0.05;
          return (
            <Animated.View key={i} style={{ opacity: fade(p, at, at + 0.02), transform: [{ scale: pop(p, at, at + 0.1) }] }}>
              <Icon name="star" size={16} color={c.gold} />
            </Animated.View>
          );
        })}
      </View>
    </>
  );
}

const SceneBothRev = (s: Scene) => <SceneBoth {...s} rev />;

const SCENES: Record<Beat, (s: Scene) => ReactNode> = {
  ask: SceneAsk,
  offers: SceneOffers,
  held: SceneHeld,
  paid: ScenePaid,
  both: SceneBoth,
  jobs: SceneJobs,
  offer: SceneOffer,
  earnHeld: SceneEarnHeld,
  earnWork: SceneEarnWork,
  earnPaid: SceneEarnPaid,
};

/**
 * How TaskDrop works, played as one small story on the first page a new person
 * sees: asking, offers, money held, approving, and earning with the same
 * account. It plays by itself and loops. Tapping the picture goes to the next
 * part and the bars jump to any part. With Reduce Motion on it holds each
 * finished picture and only moves when tapped.
 */
export function WelcomeStory({ side = 'hire' }: { side?: 'hire' | 'earn' }) {
  const t = useTheme();
  // Opened from Earn home it tells the earn parts and ends on the switch back to Hire.
  const BEATS: readonly { key: Beat; title: string; body: string }[] = side === 'earn' ? EARN_BEATS : HIRE_BEATS;
  const c = t.colors;
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  // The narrowest phones: page gutters are 20 a side, and the picture keeps 12 of its own.
  const fit = Math.min(1, (width - 64) / W);
  const [beat, setBeat] = useState(0);
  // One clock per part. A part's clock rests at 1, where it is faded out, so a
  // new part never shows its last frame before it restarts.
  const clocks = useRef(BEATS.map(() => new Animated.Value(1))).current;
  const p = clocks[beat];
  const next = () => setBeat((b) => (b + 1) % BEATS.length);

  useEffect(() => {
    if (reduced) {
      p.setValue(1);
      return;
    }
    p.setValue(0);
    const run = Animated.timing(p, { toValue: 1, duration: BEAT_MS, easing: Easing.linear, useNativeDriver: LOOP_NATIVE });
    run.start(({ finished }) => {
      if (finished) setBeat((b) => (b + 1) % BEATS.length);
    });
    return () => run.stop();
  }, [p, reduced]);

  const show = reduced ? 1 : p.interpolate({ inputRange: [0, 0.04, 0.96, 1], outputRange: [0, 1, 1, 0] });
  const lift = reduced ? 0 : p.interpolate({ inputRange: [0, 0.06], outputRange: [8, 0], extrapolate: 'clamp' });
  const now = BEATS[beat];
  const Picture = now.key === 'both' && side === 'earn' ? SceneBothRev : SCENES[now.key];

  return (
    <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', marginTop: 18 }}>
      <Pressable
        onPress={next}
        accessibilityRole="button"
        accessibilityLabel={`How TaskDrop works, part ${beat + 1} of ${BEATS.length}. ${now.title}. ${now.body}`}
        accessibilityHint="Goes to the next part"
        style={{ height: H + 28, borderRadius: 26, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }}
      >
        <Animated.View key={now.key} style={{ width: W, height: H, opacity: show, transform: [{ scale: fit }] }}>
          <Picture p={p} t={t} />
        </Animated.View>
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}>
        {BEATS.map((b, i) => (
          <Pressable key={b.key} onPress={() => setBeat(i)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Part ${i + 1}: ${b.title}`}>
            <View style={{ width: BAR, height: 4, borderRadius: 4, overflow: 'hidden', backgroundColor: c.line }}>
              {i < beat || i === beat ? (
                <Animated.View
                  style={{
                    width: BAR,
                    height: 4,
                    backgroundColor: c.accent,
                    transform: [{ translateX: i === beat ? p.interpolate({ inputRange: [0, 1], outputRange: [-BAR, 0] }) : 0 }],
                  }}
                />
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
      <Animated.View style={{ marginTop: 12, minHeight: 66, opacity: show, transform: [{ translateY: lift }] }}>
        <RNText style={tx('800', 17, c.ink, { textAlign: 'center', letterSpacing: -0.3 })}>{now.title}</RNText>
        <RNText style={tx('400', 13.5, c.muted, { textAlign: 'center', lineHeight: 20, marginTop: 4 })}>{now.body}</RNText>
      </Animated.View>
    </View>
  );
}
