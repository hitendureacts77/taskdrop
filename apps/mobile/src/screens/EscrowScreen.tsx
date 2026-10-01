import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { View, Text as RNText, Pressable, Animated, ScrollView } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { getTaskDetail, getWallet, payTaskFromWallet, WalletShortError } from '../data/api';
import { posterEscrowCharge } from '@taskdrop/rules';
import { Pressy, tx } from '../components/primitives';
import { AddFundsSheet } from '../components/AddFundsSheet';

/** Shield + checkmark; the check draws in over ~0.7s. Cleans up on unmount. */
function ShieldCheck({ color }: { color: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: 1, duration: 700, delay: 150, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [progress]);
  const AnimatedPath = Animated.createAnimatedComponent(Path);
  const dashoffset = progress.interpolate({ inputRange: [0, 1], outputRange: [60, 0] });
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
      <AnimatedPath
        d="m9 12 2.2 2.2L15.5 10"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={60}
        strokeDashoffset={dashoffset as unknown as number}
      />
    </Svg>
  );
}

/**
 * Paying for a job that is locked but not yet paid for -- an auto-hire that
 * found the wallet short, or a job from before jobs were paid at the moment of
 * choosing. The money comes from the poster's TaskDrop wallet and is locked in
 * the job until it is done; a short wallet is topped up by exactly the
 * difference, and the job is paid as soon as that lands.
 */
export function EscrowScreen() {
  const t = useTheme();
  const { params, go, back } = useNav();
  const { celebrate, flash } = useApp();
  const [busy, setBusy] = useState(false);
  const [balanceMinor, setBalanceMinor] = useState<number | null>(null);
  const [shortBy, setShortBy] = useState<number | null>(null);

  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  const title = typeof params.title === 'string' ? params.title : null;
  const who = typeof params.who === 'string' ? params.who : null;
  const by = typeof params.by === 'string' ? params.by : null;
  // No fallback price: arriving without a chosen offer means there is nothing to pay.
  const lockedMinor = typeof params.priceMinor === 'number' ? params.priceMinor : null;

  // What the database says this costs -- the only figure that can pay for the
  // job. The local calculation is a first paint while this loads.
  const [dueMinor, setDueMinor] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (taskId) {
      void getTaskDetail(taskId)
        .then((d) => {
          if (alive && d?.assignment?.escrow_minor) setDueMinor(Number(d.assignment.escrow_minor));
        })
        .catch(() => {});
    }
    void getWallet()
      .then((w) => alive && setBalanceMinor(w?.balance_minor ?? 0))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [taskId]);

  const totalMinor = dueMinor ?? (lockedMinor === null ? 0 : posterEscrowCharge(lockedMinor));
  const feeMinor = lockedMinor === null ? 0 : totalMinor - lockedMinor;
  const enough = balanceMinor !== null && balanceMinor >= totalMinor;

  const rows: { label: string; value: string; strong: boolean }[] = [
    { label: who ? `Chosen offer · ${who}` : 'Chosen offer', value: formatINR(lockedMinor ?? 0), strong: false },
    { label: 'TaskDrop service fee · 3%', value: formatINR(feeMinor), strong: false },
    ...(by ? [{ label: 'Complete by', value: by, strong: false }] : []),
    { label: 'Locked in this task', value: formatINR(totalMinor), strong: true },
  ];

  const pay = async () => {
    if (busy || !taskId) return;
    setBusy(true);
    try {
      await payTaskFromWallet(taskId);
      celebrate(`${formatINR(totalMinor)} paid from your wallet`);
      go('taskManage', { taskId });
    } catch (e) {
      if (e instanceof WalletShortError) setShortBy(e.shortMinor);
      else flash(e instanceof Error ? e.message : 'Could not pay for this task');
    } finally {
      setBusy(false);
    }
  };

  if (lockedMinor === null || !taskId) {
    return (
      <Screen padded={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
              <Icon name="back" size={20} color={t.colors.ink} />
            </Pressable>
            <RNText style={tx('700', 17, t.colors.ink)}>Pay for this task</RNText>
          </View>
          <RNText style={tx('800', 20, t.colors.ink, { marginTop: 40, letterSpacing: -0.4 })}>Nothing to pay for yet</RNText>
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 10, lineHeight: 21 })}>
            You pay once you choose an offer. Open the request and pick the offer you want.
          </RNText>
          <Pressy
            onPress={() => go('orders')}
            style={{ marginTop: 22, backgroundColor: t.colors.accent, borderRadius: 999, paddingVertical: 15, alignItems: 'center' }}
          >
            <RNText style={tx('700', 15, t.colors.onAccent)}>Go to my requests</RNText>
          </Pressy>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="back" size={20} color={t.colors.ink} />
          </Pressable>
          <RNText style={tx('700', 17, t.colors.ink)}>Pay for this task</RNText>
        </View>

        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 24 })}>Locked in the task until it is done</RNText>
        <RNText style={tx('700', 15, t.colors.ink, { marginTop: 6 })} numberOfLines={2}>
          {title}
        </RNText>
        <RNText style={tx('800', 44, t.colors.ink, { letterSpacing: -1.76, lineHeight: 46.2, marginTop: 5 })}>
          {formatINR(totalMinor)}
        </RNText>

        <View style={{ marginTop: 22 }}>
          {rows.map((r) => (
            <View
              key={r.label}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: t.colors.line }}
            >
              <RNText style={tx('400', 14, r.strong ? t.colors.ink : t.colors.muted)}>{r.label}</RNText>
              <RNText style={tx(r.strong ? '800' : '600', 14, t.colors.ink)}>{r.value}</RNText>
            </View>
          ))}
        </View>

        {/* Where the money comes from. */}
        <View
          style={{
            marginTop: 20,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderWidth: 1,
            borderColor: enough ? t.colors.line : t.colors.signal,
            borderRadius: 14,
            padding: 15,
          }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="wallet" size={18} color={t.colors.accentDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 14, t.colors.ink)}>Your TaskDrop wallet</RNText>
            <RNText style={tx('400', 13, enough ? t.colors.muted : t.colors.signalDeep, { marginTop: 3 })}>
              {balanceMinor === null
                ? 'Checking your balance…'
                : enough
                  ? `${formatINR(balanceMinor)} available`
                  : `${formatINR(balanceMinor)} available · ${formatINR(totalMinor - balanceMinor)} short`}
            </RNText>
          </View>
        </View>

        <View
          style={{
            marginTop: 14,
            backgroundColor: t.colors.accentSoft,
            borderWidth: 1,
            borderColor: t.colors.accentBorder,
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 16,
            flexDirection: 'row',
            gap: 12,
          }}
        >
          <ShieldCheck color={t.colors.accent} />
          <RNText style={tx('400', 13, t.colors.accentDeep, { lineHeight: 19.5, flex: 1 })}>
            The money stays locked in this task and cannot be withdrawn. The worker is paid only when you approve the
            work. If the task is cancelled or not completed, all of it — service fee included — comes back to your
            wallet.
          </RNText>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressy
          onPress={() => (enough || balanceMinor === null ? void pay() : setShortBy(totalMinor - (balanceMinor ?? 0)))}
          scaleTo={0.96}
          style={{
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: busy ? 0.7 : 1,
          }}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>
            {busy
              ? 'Paying…'
              : enough || balanceMinor === null
                ? `Pay ${formatINR(totalMinor)} from wallet`
                : `Add ${formatINR(totalMinor - balanceMinor)} and pay`}
          </RNText>
        </Pressy>
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10 })}>
          Phone numbers are shared once the work starts.
        </RNText>
      </View>

      <AddFundsSheet
        visible={shortBy !== null}
        initialMinor={shortBy ?? undefined}
        reason={
          shortBy !== null
            ? `Your wallet is ${formatINR(shortBy)} short for this task. Add at least that much, and the task is paid as soon as the money arrives.`
            : undefined
        }
        onClose={() => setShortBy(null)}
        flash={flash}
        onFunded={(added) => {
          setShortBy(null);
          setBalanceMinor((b) => (b ?? 0) + added);
          void pay();
        }}
      />
    </Screen>
  );
}
