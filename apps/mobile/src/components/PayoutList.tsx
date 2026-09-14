import { View, Text as RNText, Pressable, ActivityIndicator } from 'react-native';
import { formatINR } from './ui';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import type { Payout } from '../data/api';
import type { Theme } from '../theme';

/**
 * What happened to the money after you asked for it.
 *
 * Without this the withdraw screen was a one-way door: you tapped Withdraw,
 * the balance dropped, and there was nothing anywhere in the app that said
 * where the money had gone or let you take it back. Every payout system worth
 * using shows the queue and lets you cancel while cancelling is still possible.
 *
 * "Still possible" is the server's call, not this component's — the Cancel
 * button only appears for a payout the server would accept, and the server
 * checks again anyway.
 */

export function payoutTone(t: Theme, status: Payout['status']) {
  switch (status) {
    case 'paid':
      return { ink: t.colors.accentDeep, bg: t.colors.accentSoft, label: 'Paid' };
    case 'processing':
      return { ink: t.colors.blue, bg: t.colors.surface2, label: 'Sending' };
    case 'failed':
      return { ink: t.colors.signalDeep, bg: t.colors.signalSoft, label: 'Failed' };
    case 'cancelled':
      return { ink: t.colors.muted, bg: t.colors.surface2, label: 'Cancelled' };
    default:
      return { ink: t.colors.purpleDeep, bg: t.colors.surface2, label: 'Requested' };
  }
}

function whenText(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function PayoutList({
  payouts,
  loading,
  cancellingId,
  onCancel,
}: {
  payouts: Payout[];
  loading: boolean;
  cancellingId: string | null;
  onCancel: (payout: Payout) => void;
}) {
  const t = useTheme();

  if (loading) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 18 }}>
        <ActivityIndicator size="small" color={t.colors.muted} />
        <RNText style={tx('400', 13, t.colors.muted)}>Loading your withdrawals…</RNText>
      </View>
    );
  }

  if (payouts.length === 0) {
    return (
      <RNText style={tx('400', 13, t.colors.muted, { paddingVertical: 16, lineHeight: 19 })}>
        Nothing withdrawn yet. Anything you take out will show up here, and you can cancel it
        while it is still waiting to be sent.
      </RNText>
    );
  }

  return (
    <View>
      {payouts.map((p) => {
        const tone = payoutTone(t, p.status);
        const cancellable = p.status === 'requested';
        const busy = cancellingId === p.id;

        return (
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
              <RNText
                style={tx('700', 11, tone.ink, {
                  backgroundColor: tone.bg,
                  paddingHorizontal: 9,
                  paddingVertical: 4,
                  borderRadius: 999,
                  overflow: 'hidden',
                })}
              >
                {tone.label}
              </RNText>
            </View>

            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
              {p.destination ?? 'No destination recorded'} · {whenText(p.created_at)}
            </RNText>

            {p.status === 'failed' && p.failure_note ? (
              <RNText style={tx('600', 12, t.colors.signalDeep, { marginTop: 6, lineHeight: 17 })}>
                {p.failure_note} — the money is back in your wallet.
              </RNText>
            ) : null}

            {p.status === 'processing' ? (
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6, lineHeight: 17 })}>
                On its way to your bank. It can no longer be cancelled.
              </RNText>
            ) : null}

            {cancellable && (
              <Pressable
                onPress={() => onCancel(p)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Cancel the ${formatINR(p.amount_minor)} withdrawal`}
                style={({ pressed }) => ({
                  marginTop: 10,
                  alignSelf: 'flex-start',
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  backgroundColor: t.colors.surface,
                  opacity: busy ? 0.6 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <RNText style={tx('700', 12, t.colors.signalDeep)}>
                  {busy ? 'Cancelling…' : 'Cancel withdrawal'}
                </RNText>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}
