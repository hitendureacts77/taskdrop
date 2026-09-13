import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { Screen, Text, Card, Row, Button, Divider, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { confirmRelease as confirmReleaseOnServer } from '../data/api';

/**
 * Poster flow: confirm work done → release escrow. Design parity with
 * docs/design/_design_source.jsx lines 769-785 (`confirmRelease`,
 * `releaseRows`, `proofNote`). Not the lock-quote screen — that's EscrowScreen.
 * TaskDrop takes a flat 20% worker commission, so the worker nets 80% of the
 * locked price on release (see `releaseNum` in the design source).
 */

const FALLBACK_TITLE = 'Photograph a flat before I rent it';
const FALLBACK_PRICE_MINOR = 45000; // ₹450
const FALLBACK_ESCROW_MINOR = 46300; // ₹463 — matches the design's fallback task

/** The design stores task.price/task.escrow as rupee strings like '₹4,200'. */
function parseRupeeStringToMinor(value?: string): number | null {
  if (!value) return null;
  const n = parseInt(value.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n * 100 : null;
}

export function ConfirmScreen() {
  const t = useTheme();
  const { params, go } = useNav();
  const { openTask, balance, escrow, roll, setDone, celebrate, flash } = useApp();

  const title =
    typeof params.title === 'string'
      ? params.title
      : (openTask?.title ?? FALLBACK_TITLE);

  const priceMinor =
    typeof params.priceMinor === 'number'
      ? params.priceMinor
      : (parseRupeeStringToMinor(openTask?.price) ?? FALLBACK_PRICE_MINOR);

  const escrowMinor =
    typeof params.escrowMinor === 'number'
      ? params.escrowMinor
      : (parseRupeeStringToMinor(openTask?.escrow) ?? FALLBACK_ESCROW_MINOR);

  const releaseMinor = Math.round(priceMinor * 0.8);
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  const [busy, setBusy] = useState(false);

  const releaseRows = [
    { label: 'Held in escrow', value: formatINR(escrowMinor) },
    { label: 'Releases to the worker', value: formatINR(releaseMinor) },
    { label: 'Auto-confirms in', value: '2 days 4 hrs' },
  ];

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The commission split happens in Postgres; the numbers below only mirror it.
      if (taskId) await confirmReleaseOnServer(taskId);
      roll('balance', balance + releaseMinor);
      roll('escrow', Math.max(0, escrow - escrowMinor));
      setDone(title, 2);
      celebrate(`Escrow released · ${formatINR(releaseMinor)}`);
      go('review', { title, taskId });
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not release the escrow');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Text color="accent" variant="label" style={{ marginTop: 8 }}>
        CONFIRM WORK
      </Text>
      <Text variant="h1" style={{ marginTop: 4, marginBottom: t.spacing.lg }}>
        {title}
      </Text>

      <Card style={{ backgroundColor: t.colors.surface2, borderColor: 'transparent', marginBottom: t.spacing.lg }}>
        <Text variant="label" color="muted" style={{ marginBottom: 4 }}>
          PROOF SUBMITTED
        </Text>
        <Text variant="body">Photographed every room, the balcony and the meter. Full set uploaded.</Text>
      </Card>

      <Card style={{ marginBottom: t.spacing.lg }}>
        {releaseRows.map((row, i) => (
          <React.Fragment key={row.label}>
            <Row justify="space-between" style={{ paddingVertical: i === 0 ? 4 : 10 }}>
              <Text color="muted" variant="label">
                {row.label}
              </Text>
              <Text
                variant={i === 1 ? 'h3' : 'label'}
                color={i === 1 ? 'accent' : 'text'}
              >
                {row.value}
              </Text>
            </Row>
            {i < releaseRows.length - 1 && <Divider />}
          </React.Fragment>
        ))}
      </Card>

      <Card style={{ backgroundColor: t.colors.accentSoft, borderColor: t.colors.accentBorder, marginBottom: t.spacing.xl }}>
        <Text variant="body" style={{ color: t.colors.accentDeep }}>
          The worker nets 80% of the locked price — TaskDrop takes a flat 20% commission on every
          completed order.
        </Text>
      </Card>

      <Button
        label={busy ? 'Releasing…' : `Confirm and release ${formatINR(releaseMinor)}`}
        onPress={handleConfirm}
      />
      <Button
        label="Request changes"
        variant="secondary"
        style={{ marginTop: t.spacing.md }}
        onPress={() => flash('Change request sent to the worker')}
      />

      <Pressable
        onPress={() => flash('A dispute case was opened')}
        style={{ marginTop: t.spacing.lg, alignItems: 'center', padding: t.spacing.sm }}
      >
        <Text variant="label" color="signal">
          Open a dispute
        </Text>
      </Pressable>
    </Screen>
  );
}
