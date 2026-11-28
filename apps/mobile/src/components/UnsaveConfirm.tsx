import { useCallback, useState, type ReactElement } from 'react';
import { ConfirmDialog } from './kit';

/** The words of the "remove from saved?" question, shared by every screen with a bookmark (owner, 28 Nov). */
export const UNSAVE_WORDS = {
  title: 'Remove from saved?',
  message: 'You can save it again any time.',
  confirmLabel: 'Remove',
  cancelLabel: 'Keep it',
} as const;

/**
 * Saving a task stays one tap; taking it off the saved list asks first, so a
 * stray tap on the bookmark does not lose it. Works the same for guest saves.
 *
 *   const unsave = useUnsaveConfirm();
 *   onToggleSave={() => unsave.ask(() => void remove(task.id))}
 *   ...
 *   {unsave.dialog}
 */
export function useUnsaveConfirm(): { ask: (run: () => void) => void; dialog: ReactElement } {
  // The pending removal, held in an object so a function can be stored in state.
  const [pending, setPending] = useState<{ run: () => void } | null>(null);
  const ask = useCallback((run: () => void) => setPending({ run }), []);
  const dialog = (
    <ConfirmDialog
      visible={pending !== null}
      icon="bookmark"
      title={UNSAVE_WORDS.title}
      message={UNSAVE_WORDS.message}
      confirmLabel={UNSAVE_WORDS.confirmLabel}
      cancelLabel={UNSAVE_WORDS.cancelLabel}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const p = pending;
        setPending(null);
        p?.run();
      }}
    />
  );
  return { ask, dialog };
}
