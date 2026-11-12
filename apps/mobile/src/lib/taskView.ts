/**
 * How the task page is drawn: by what the task IS (a request someone posted, or a service someone
 * offers), not only by the Hire/Earn switch. In Hire mode a request used to open as if it were a
 * service ("THEIR RATE", "Send <name> a task"); a request is always shown as a request.
 * Pure, tested in Node (taskView.test.ts).
 */

export type TaskPageKind = 'request' | 'service' | null | undefined;

export type TaskPanel = 'offer' | 'sendTask' | 'switchToEarn';

export type TaskPageView = {
  /** Draw the page as a request: "Budget" and a poster's record. Otherwise as a service: "Their rate". */
  asRequest: boolean;
  /** Which box sits under the details. */
  panel: TaskPanel;
};

export function taskPageView(mode: 'worker' | 'poster', kind: TaskPageKind): TaskPageView {
  // Earn mode is unchanged: it is always the request view with the offer box.
  if (mode === 'worker') return { asRequest: true, panel: 'offer' };
  // Hire mode on a request: shown as a request, but you cannot send an offer to it from here.
  if (kind === 'request') return { asRequest: true, panel: 'switchToEarn' };
  // Hire mode on a service (or a kind not known yet): today's Hire view.
  return { asRequest: false, panel: 'sendTask' };
}
