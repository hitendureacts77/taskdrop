import React, { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { Screen, Text, Card, Row, Button, Divider, formatINR } from '../components/ui';
import { TaskDescription } from '../components/TaskDescription';
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
 * TaskDrop takes a flat worker commission (the worker_commission_pct setting),
 * applied in Postgres on release.
 * Deliberately NOT surfaced here: the poster sees what they put in escrow and
 * nothing that lets them derive our cut, so don't reintroduce the worker's net
 * figure on this screen (or in its toast) — the same applies to ActiveScreen's
 * confirm button. Commission belongs in the admin analytics view.
 */


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

  const title = typeof params.title === 'string' ? params.title : (openTask?.title ?? null);

  // No invented price. This screen releases escrow to a worker, and a default
  // here meant a task that did not exist still showed a confident payout.
  const priceMinor =
    typeof params.priceMinor === 'number'
      ? params.priceMinor
      : parseRupeeStringToMinor(openTask?.price);

  const releaseMinor = priceMinor === null ? 0 : workerNetPayout(priceMinor);
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
      : parseRupeeStringToMinor(openTask?.escrow));

  // What the poster sees is their own side of the deal: the amount they put in
  // escrow and when it settles on its own. The commission split is the
  // platform's business and is applied in Postgres — showing the worker's net
  // here let anyone read our cut straight off the screen.
  const releaseRows = [
    { label: 'Held safely', value: escrowMinor === null ? '—' : formatINR(escrowMinor) },
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
      celebrate('Problem reported · payment is on hold');
      go('orders');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not report the problem');
    } finally {
      setBusy(false);
    }
  };
  const handleConfirm = async () => {
    if (busy) return;
    // Without a real task there is nothing to release. It used to skip the
    // server call and still roll the balance and celebrate "Escrow released",
    // which is a success message for something that never happened.
    if (!taskId) {
      flash('This is a sample task — open a real one from your requests');
      return;
    }
    setBusy(true);
    try {
      // The commission split happens in Postgres; the numbers below only mirror it.
      await confirmReleaseOnServer(taskId);
      roll('balance', balance + releaseMinor);
      roll('escrow', Math.max(0, escrow - (escrowMinor ?? 0)));
      if (title) setDone(title, 2);
      // Not the worker's net — that figure is our commission made visible.
      celebrate('Payment released');
      go('review', { title: title ?? '', taskId });
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not release the payment');
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
        {title ?? "No task selected"}
      </Text>

      <Card style={{ backgroundColor: t.colors.surface2, borderColor: 'transparent', marginBottom: t.spacing.lg }}>
        <Text variant="label" color="muted" style={{ marginBottom: 4 }}>
          WHAT YOU ASKED FOR
        </Text>
        {detail?.task.description?.trim() ? (
          <TaskDescription text={detail.task.description} title={detail.task.title} size="sm" />
        ) : (
          <Text variant="body">The worker marked this done. Check the work before you release the payment.</Text>
        )}
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
          Releasing pays the worker and closes this order. If something is not right, send it back
          for changes before you release.
        </Text>
      </Card>

      <Button
        label={busy ? 'Releasing…' : 'Confirm and release payment'}
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
          Report a problem
        </Text>
      </Pressable>
    </Screen>
  );
}
