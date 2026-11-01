import { Badge, type Tone } from './kit';

type OptionFields = {
  flash_until?: string | null;
  live_answer?: boolean | null;
  crew_size?: number | null;
  crew_slot?: number | null;
  want_photos?: boolean | null;
  preferred_until?: string | null;
  repeat_every?: string | null;
};

/** The poster's options (migration 134) as short labels, for cards and task pages. */
export function optionLabels(task: OptionFields, now: number = Date.now()): { label: string; tone: Tone }[] {
  const out: { label: string; tone: Tone }[] = [];
  if (task.flash_until && new Date(task.flash_until).getTime() > now) out.push({ label: 'Flash Drop', tone: 'signal' });
  if (task.live_answer) out.push({ label: 'Live answer', tone: 'accent' });
  if (task.crew_size) out.push({ label: `Crew ${task.crew_slot ?? 1} of ${task.crew_size}`, tone: 'blue' });
  if (task.preferred_until && new Date(task.preferred_until).getTime() > now) out.push({ label: 'Asked a regular first', tone: 'purple' });
  if (task.want_photos) out.push({ label: 'Photos asked', tone: 'neutral' });
  if (task.repeat_every) out.push({ label: task.repeat_every === 'month' ? 'Monthly' : 'Weekly', tone: 'neutral' });
  return out;
}

export function OptionBadges({ task }: { task: OptionFields }) {
  return (
    <>
      {optionLabels(task).map((b) => (
        <Badge key={b.label} label={b.label} tone={b.tone} />
      ))}
    </>
  );
}
