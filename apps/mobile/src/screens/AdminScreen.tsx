import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  isAdmin,
  adminPayoutQueue,
  adminMarkPayout,
  adminDisputes,
  adminResolveDispute,
  settleClearedEarnings,
  type AdminPayout,
  type AdminDispute,
} from '../data/api';
import { tx } from '../components/primitives';

/**
 * The owner's console.
 *
 * Before this, being an admin meant seeing a dashboard. There was no way to
 * pay a withdrawal, settle a dispute, or release cleared earnings — the
 * database had exactly one admin-only function and it was a read. Money went
 * into the system and had no way out except raw SQL.
 *
 * The three things here are the three that actually block the money moving:
 * the payout queue, the dispute queue, and the clearing sweep. Every button
 * calls a function that re-checks the admin role server-side; this screen
 * hiding itself is a courtesy, not the security.
 */

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 26 }}>
      <RNText style={tx('800', 17, t.colors.ink, { letterSpacing: -0.3 })}>{title}</RNText>
      {sub ? (
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
          {sub}
        </RNText>
      ) : null}
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
}

function ActionButton({
  label,
  tone = 'plain',
  disabled,
  onPress,
}: {
  label: string;
  tone?: 'plain' | 'accent' | 'warn';
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const ink =
    tone === 'accent' ? t.colors.onAccent : tone === 'warn' ? t.colors.signalDeep : t.colors.ink;
  const bg =
    tone === 'accent' ? t.colors.accent : tone === 'warn' ? t.colors.signalSoft : t.colors.surface;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: tone === 'accent' ? t.colors.accent : t.colors.line,
        opacity: disabled ? 0.45 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <RNText style={tx('700', 12, ink)}>{label}</RNText>
    </Pressable>
  );
}

export function AdminScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { flash, celebrate } = useApp();
  const { userId } = useAuth();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [p, d] = await Promise.allSettled([adminPayoutQueue(), adminDisputes()]);
    if (p.status === 'fulfilled') setPayouts(p.value);
    if (d.status === 'fulfilled') setDisputes(d.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    void isAdmin(userId)
      .then((ok) => {
        if (!alive) return;
        setAllowed(ok);
        if (ok) void refresh();
        else setLoading(false);
      })
      .catch(() => alive && setAllowed(false));
    return () => {
      alive = false;
    };
  }, [userId, refresh]);

  const act = async (id: string, run: () => Promise<unknown>, done: string) => {
    if (workingId) return;
    setWorkingId(id);
    try {
      await run();
      celebrate(done);
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'That did not go through');
    } finally {
      setWorkingId(null);
    }
  };

  const sweep = async () => {
    if (workingId) return;
    setWorkingId('sweep');
    try {
      const n = await settleClearedEarnings();
      celebrate(
        n === 0
          ? 'Nothing had finished clearing'
          : `${n} ${n === 1 ? 'payment' : 'payments'} moved into withdrawable balance`,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not settle earnings');
    } finally {
      setWorkingId(null);
    }
  };

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
      </Pressable>
      <RNText style={tx('700', 17, t.colors.ink)}>Run TaskDrop</RNText>
    </View>
  );

  if (allowed === false) {
    return (
      <Screen padded={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          {header}
          <RNText style={tx('800', 20, t.colors.ink, { marginTop: 40, letterSpacing: -0.4 })}>
            Admins only
          </RNText>
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 10, lineHeight: 21 })}>
            This console moves other people&apos;s money, so it is limited to accounts holding the
            admin role. Every action here is checked again on the server.
          </RNText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {header}

        {loading ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 30 }}>
            <ActivityIndicator color={t.colors.accent} />
            <RNText style={tx('400', 13, t.colors.muted)}>Loading the queues…</RNText>
          </View>
        ) : (
          <>
            <Section
              title="Withdrawals to send"
              sub="Money has already left these wallets. Mark one paid once the transfer is out, or failed to put it back."
            >
              {payouts.length === 0 ? (
                <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>
                  Nothing waiting. Anything a worker requests shows up here.
                </RNText>
              ) : (
                payouts.map((p) => (
                  <View
                    key={p.id}
                    style={{
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: t.colors.line,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <RNText style={tx('800', 16, t.colors.ink, { flex: 1 })}>
                        {formatINR(p.amount_minor)}
                      </RNText>
                      <RNText style={tx('700', 11, t.colors.muted)}>{p.status}</RNText>
                    </View>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
                      {p.profile?.display_name ?? 'Unknown'} · {p.destination ?? 'no destination'}
                    </RNText>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {p.status === 'requested' && (
                        <ActionButton
                          label="Start sending"
                          disabled={workingId !== null}
                          onPress={() =>
                            void act(
                              p.id,
                              () => adminMarkPayout(p.id, 'processing'),
                              'Marked as sending',
                            )
                          }
                        />
                      )}
                      <ActionButton
                        label="Mark paid"
                        tone="accent"
                        disabled={workingId !== null}
                        onPress={() =>
                          void act(p.id, () => adminMarkPayout(p.id, 'paid'), 'Marked paid')
                        }
                      />
                      <ActionButton
                        label="Failed — refund"
                        tone="warn"
                        disabled={workingId !== null}
                        onPress={() =>
                          void act(
                            p.id,
                            () =>
                              adminMarkPayout(p.id, 'failed', 'The bank would not accept this'),
                            'Refunded to their wallet',
                          )
                        }
                      />
                    </View>
                  </View>
                ))
              )}
            </Section>

            <Section
              title="Disputes to settle"
              sub="Escrow on these is frozen until you decide. Neither side can move it."
            >
              {disputes.length === 0 ? (
                <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>
                  Nothing in dispute.
                </RNText>
              ) : (
                disputes.map((d) => (
                  <View
                    key={d.id}
                    style={{
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: t.colors.line,
                    }}
                  >
                    <RNText style={tx('700', 15, t.colors.ink)} numberOfLines={2}>
                      {d.title}
                    </RNText>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
                      {d.locked_minor ? formatINR(d.locked_minor) : 'no locked amount'} ·{' '}
                      {d.poster?.display_name ?? 'Unknown poster'}
                    </RNText>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <ActionButton
                        label="Pay the worker"
                        tone="accent"
                        disabled={workingId !== null}
                        onPress={() =>
                          void act(
                            d.id,
                            () => adminResolveDispute(d.id, 'worker'),
                            'Released to the worker',
                          )
                        }
                      />
                      <ActionButton
                        label="Refund the poster"
                        tone="warn"
                        disabled={workingId !== null}
                        onPress={() =>
                          void act(
                            d.id,
                            () => adminResolveDispute(d.id, 'poster'),
                            'Refunded to the poster',
                          )
                        }
                      />
                    </View>
                  </View>
                ))
              )}
            </Section>

            <Section
              title="Release cleared earnings"
              sub="Completed work sits in clearing for seven days, then becomes withdrawable. Run this to move everything that is due."
            >
              <ActionButton
                label={workingId === 'sweep' ? 'Settling…' : 'Settle everything due'}
                tone="accent"
                disabled={workingId !== null}
                onPress={() => void sweep()}
              />
            </Section>

            <Section title="Numbers" sub="Revenue, volume and the health of the marketplace.">
              <ActionButton label="Open analytics" onPress={() => go('analytics')} />
            </Section>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
