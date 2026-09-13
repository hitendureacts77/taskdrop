import React, { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { Screen, Text, Card, Row, Button, Divider, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import {
  confirmRelease as confirmReleaseOnServer,
  requestRevision,
  openDispute,
  getTaskDetail,
  type TaskDetail,
} from '../data/api';
import { workerNetPayout } from '@taskdrop/rules';

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

/** "2 days 4 hrs" style countdown to the task auto-confirming on its own. */
function countdown(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'any moment';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return days + (days === 1 ? ' day ' : ' days ') + (hours % 24) + ' hrs';
  if (hours >= 1) return hours + (hours === 1 ? ' hr' : ' hrs');
  return Math.max(1, Math.floor(ms / 60_000)) + ' min';
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

  const releaseMinor = workerNetPayout(priceMinor);
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<TaskDetail | null>(null);

  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    getTaskDetail(taskId)
      .then((d) => alive && setDetail(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [taskId]);

  const escrowMinor =
    detail?.assignment?.escrow_minor ??
    (typeof params.escrowMinor === 'number'
      ? params.escrowMinor
      : (parseRupeeStringToMinor(openTask?.escrow) ?? FALLBACK_ESCROW_MINOR));

  const releaseRows = [
    { label: 'Held in escrow', value: formatINR(escrowMinor) },
    { label: 'Releases to the worker', value: formatINR(releaseMinor) },
    { label: 'Auto-confirms in', value: countdown(detail?.task.auto_complete_at ?? null) },
  ];

  const askForChanges = async () => {
    if (busy) return;
    if (!taskId) return flash('This is a sample task');
    setBusy(true);
    try {
      await requestRevision(taskId);
      celebrate('Sent back for changes');
      go('orders');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send that back');
    } finally {
      setBusy(false);
    }
  };

  const raiseDispute = async () => {
    if (busy) return;
    if (!taskId) return flash('This is a sample task');
    setBusy(true);
    try {
      await openDispute(taskId);
      // Escrow is frozen, not moved — an admin resolves it from here.
      celebrate('Dispute opened · escrow is frozen');
      go('orders');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not open a dispute');
    } finally {
      setBusy(false);
    }
  };
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
          WHAT YOU ASKED FOR
        </Text>
        <Text variant="body">
          {detail?.task.description?.trim()
            ? detail.task.description
            : 'The worker marked this done. Check the work before you release the escrow.'}
        </Text>
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
        onPress={askForChanges}
      />

      <Pressable
        onPress={raiseDispute}
        style={{ marginTop: t.spacing.lg, alignItems: 'center', padding: t.spacing.sm }}
      >
        <Text variant="label" color="signal">
          Open a dispute
        </Text>
      </Pressable>
    </Screen>
  );
}
