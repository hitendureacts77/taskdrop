import { View, Text as RNText } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import type { Theme } from '../theme';
import { tx } from './primitives';

type Scene = 'describe' | 'quotes' | 'escrow' | 'done' | 'find' | 'quote' | 'work' | 'paid';

type Step = { scene: Scene; title: string; body: string };

const HIRE: Step[] = [
  { scene: 'describe', title: 'Say what you need', body: 'Type or speak it. The AI shapes it into a clear post with a fair budget.' },
  { scene: 'quotes', title: 'Quotes come to you', body: 'Nearby and remote taskers send prices. Compare them side by side, or let one auto-accept.' },
  { scene: 'escrow', title: 'Money waits safely', body: 'You fund the job, and TaskDrop holds it. Nobody is paid before the work is done.' },
  { scene: 'done', title: 'Approve and rate', body: 'Check the work, release payment, and leave a rating for the next person.' },
];

const EARN: Step[] = [
  { scene: 'find', title: 'Find a job', body: 'Matches for your skills, jobs near your area, and remote work, all on your home.' },
  { scene: 'quote', title: 'Send your quote', body: 'Your price and why you. You can edit it any time until the poster accepts.' },
  { scene: 'work', title: 'Do the work', body: 'The money is already in escrow before you start, so you know it is there.' },
  { scene: 'paid', title: 'Get paid', body: 'When the poster approves, it clears to your wallet. Withdraw to UPI or bank.' },
];

/**
 * How TaskDrop works, as pictures: four small illustrated scenes joined by a
 * dashed path, for whichever side the person is on.
 */
export function HowItWorks({ side = 'hire' }: { side?: 'hire' | 'earn' }) {
  const t = useTheme();
  const steps = side === 'earn' ? EARN : HIRE;
  const tone = side === 'earn' ? t.colors.purpleDeep : t.colors.accentDeep;
  const soft = side === 'earn' ? t.colors.purple + '1F' : t.colors.accentSoft;

  return (
    <View style={{ marginTop: 14 }}>
      {steps.map((s, i) => {
        const flip = i % 2 === 1;
        return (
          <View key={s.scene}>
            <View style={{ flexDirection: flip ? 'row-reverse' : 'row', alignItems: 'center', gap: 14 }}>
              <View
                style={{
                  width: 116,
                  height: 104,
                  borderRadius: 22,
                  backgroundColor: soft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Illustration scene={s.scene} t={t} tone={tone} />
                <View
                  style={{
                    position: 'absolute',
                    top: -8,
                    [flip ? 'right' : 'left']: -8,
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    backgroundColor: tone,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 3,
                    borderColor: t.colors.bg,
                  }}
                >
                  <RNText style={tx('800', 11, '#FFFFFF')}>{i + 1}</RNText>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <RNText style={tx('800', 15, t.colors.ink)}>{s.title}</RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 17 })}>{s.body}</RNText>
              </View>
            </View>
            {i < steps.length - 1 ? <Connector flip={flip} color={tone} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/** A dashed curve from one scene to the next, swinging across the page. */
function Connector({ flip, color }: { flip: boolean; color: string }) {
  return (
    <View style={{ height: 34, flexDirection: 'row', justifyContent: 'center' }}>
      <Svg width="70%" height={34} viewBox="0 0 200 34" preserveAspectRatio="none">
        <Path
          d={flip ? 'M 180 2 C 180 22, 20 12, 20 32' : 'M 20 2 C 20 22, 180 12, 180 32'}
          stroke={color}
          strokeWidth={1.6}
          strokeDasharray="4 5"
          fill="none"
          opacity={0.55}
        />
      </Svg>
    </View>
  );
}

/** Small flat drawings, 96x80, in the theme's colours. */
function Illustration({ scene, t, tone }: { scene: Scene; t: Theme; tone: string }) {
  const paper = t.colors.surface;
  const line = t.colors.line;
  const gold = t.colors.gold;
  const ai = t.colors.ai;
  return (
    <Svg width={96} height={80} viewBox="0 0 96 80">
      {scene === 'describe' || scene === 'find' ? (
        <G>
          {/* phone */}
          <Rect x={30} y={6} width={36} height={66} rx={7} fill={paper} stroke={tone} strokeWidth={2} />
          <Rect x={42} y={10} width={12} height={2.5} rx={1.2} fill={line} />
          {scene === 'describe' ? (
            <G>
              <Rect x={35} y={20} width={22} height={9} rx={4} fill={tone} opacity={0.85} />
              <Rect x={39} y={33} width={22} height={9} rx={4} fill={line} />
              <Rect x={35} y={46} width={16} height={9} rx={4} fill={tone} opacity={0.85} />
              {/* AI sparkle */}
              <Path d="M76 14 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5z" fill={ai} />
              <Path d="M16 48 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z" fill={ai} opacity={0.7} />
            </G>
          ) : (
            <G>
              <Rect x={35} y={20} width={26} height={11} rx={3} fill={line} />
              <Rect x={35} y={35} width={26} height={11} rx={3} fill={tone} opacity={0.25} />
              <Rect x={35} y={50} width={26} height={11} rx={3} fill={line} />
              {/* magnifier */}
              <Circle cx={74} cy={46} r={10} fill={paper} stroke={tone} strokeWidth={3} />
              <Path d="M81 53 l8 8" stroke={tone} strokeWidth={4} strokeLinecap="round" />
              <Path d="M14 22 a4 4 0 1 1 8 0 c0 4 -4 8 -4 8 s-4 -4 -4 -8z" fill={tone} />
            </G>
          )}
        </G>
      ) : null}

      {scene === 'quotes' ? (
        <G>
          {/* map pin in the middle, quote tags around it */}
          <Circle cx={48} cy={70} r={12} fill={tone} opacity={0.12} />
          <Path d="M48 70 C 40 58, 36 52, 36 44 a12 12 0 1 1 24 0 c0 8 -4 14 -12 26z" fill={tone} />
          <Circle cx={48} cy={44} r={4.5} fill={paper} />
          <G>
            <Rect x={2} y={10} width={30} height={16} rx={8} fill={paper} stroke={line} strokeWidth={1.5} />
            <Circle cx={10} cy={18} r={4} fill={gold} />
            <Rect x={16} y={16} width={12} height={4} rx={2} fill={tone} />
          </G>
          <G>
            <Rect x={62} y={4} width={32} height={16} rx={8} fill={paper} stroke={tone} strokeWidth={1.5} />
            <Circle cx={70} cy={12} r={4} fill={ai} />
            <Rect x={76} y={10} width={14} height={4} rx={2} fill={tone} />
          </G>
          <G>
            <Rect x={66} y={32} width={28} height={16} rx={8} fill={paper} stroke={line} strokeWidth={1.5} />
            <Circle cx={74} cy={40} r={4} fill={t.colors.blue} />
            <Rect x={80} y={38} width={10} height={4} rx={2} fill={tone} />
          </G>
        </G>
      ) : null}

      {scene === 'quote' ? (
        <G>
          {/* a quote card with a price and a pencil */}
          <Rect x={14} y={10} width={58} height={62} rx={8} fill={paper} stroke={tone} strokeWidth={2} />
          <Rect x={22} y={20} width={30} height={5} rx={2.5} fill={line} />
          <Rect x={22} y={30} width={40} height={4} rx={2} fill={line} />
          <Rect x={22} y={38} width={34} height={4} rx={2} fill={line} />
          <Rect x={22} y={52} width={28} height={12} rx={6} fill={tone} />
          <Path d="M29 58 h6 M29 55 h6 M31 55 c4 0 4 6 0 6 l4 3" stroke={paper} strokeWidth={1.4} fill="none" />
          <Path d="M66 64 l18 -18 6 6 -18 18 -8 2z" fill={gold} />
          <Path d="M84 46 l6 6" stroke={t.colors.goldInk} strokeWidth={2} />
        </G>
      ) : null}

      {scene === 'escrow' || scene === 'work' ? (
        <G>
          {/* shield holding the money */}
          <Path d="M48 6 L76 16 V38 C76 56 62 68 48 74 C34 68 20 56 20 38 V16z" fill={paper} stroke={tone} strokeWidth={2.4} />
          {scene === 'escrow' ? (
            <G>
              <Rect x={38} y={36} width={20} height={16} rx={3} fill={tone} />
              <Path d="M42 36 v-5 a6 6 0 0 1 12 0 v5" stroke={tone} strokeWidth={3} fill="none" />
              <Circle cx={48} cy={44} r={2.5} fill={paper} />
              <Circle cx={12} cy={58} r={7} fill={gold} />
              <Circle cx={84} cy={60} r={6} fill={gold} opacity={0.8} />
            </G>
          ) : (
            <G>
              {/* wrench and a progress bar */}
              <Path d="M36 50 l14 -14 a7 7 0 1 1 6 6 l-14 14z" fill={tone} />
              <Rect x={30} y={60} width={36} height={5} rx={2.5} fill={line} />
              <Rect x={30} y={60} width={22} height={5} rx={2.5} fill={tone} />
              <Circle cx={84} cy={16} r={6} fill={gold} />
            </G>
          )}
        </G>
      ) : null}

      {scene === 'done' || scene === 'paid' ? (
        <G>
          {scene === 'done' ? (
            <G>
              <Circle cx={40} cy={40} r={26} fill={tone} />
              <Path d="M28 40 l8 8 16 -18" stroke={paper} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              {[0, 1, 2].map((k) => (
                <Path
                  key={k}
                  transform={`translate(${66 + (k % 2) * 12} ${12 + k * 20}) scale(0.55)`}
                  d="M12 2 l3 7 7 .6 -5.4 4.7 1.7 7 -6.3 -3.9 -6.3 3.9 1.7 -7 L2 9.6 9 9z"
                  fill={gold}
                />
              ))}
            </G>
          ) : (
            <G>
              {/* wallet with a coin dropping in */}
              <Rect x={14} y={28} width={60} height={42} rx={9} fill={tone} />
              <Rect x={14} y={28} width={60} height={12} rx={6} fill={tone} opacity={0.6} />
              <Rect x={54} y={44} width={24} height={14} rx={7} fill={paper} />
              <Circle cx={62} cy={51} r={3} fill={tone} />
              <Circle cx={44} cy={14} r={9} fill={gold} />
              <Path d="M41 10 h6 M41 13 h6 M43 13 c4 0 4 5 0 5 l4 3" stroke={t.colors.goldInk} strokeWidth={1.4} fill="none" />
              <Path d="M84 20 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z" fill={gold} />
            </G>
          )}
        </G>
      ) : null}
    </Svg>
  );
}
