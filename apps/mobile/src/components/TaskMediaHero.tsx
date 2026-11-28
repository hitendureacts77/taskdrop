import { useState } from 'react';
import { View } from 'react-native';
import { TaskMediaThumb } from './TaskMediaThumb';
import { PhotoViewer } from './PhotoViewer';
import { Icon } from './Icon';
import { Pressy } from './primitives';
import { useLayout } from '../lib/layout';

/**
 * The task's attachment on its detail page ("Bigger photos on task details", Ideas board): taller than the old
 * 210 px strip, and a photo opens full screen on a tap (PhotoViewer signs the full size only then). A video
 * keeps its tile; it is not a picture to enlarge.
 */
export function TaskMediaHero({
  path,
  kind,
  seconds,
  marginTop = 16,
}: {
  path: string;
  kind: 'image' | 'video' | null;
  seconds: number | null;
  marginTop?: number;
}) {
  const { desktop } = useLayout();
  const [open, setOpen] = useState(false);
  const height = desktop ? 340 : 280;
  const thumb = <TaskMediaThumb path={path} kind={kind} seconds={seconds} radius={20} />;
  if (kind !== 'image') return <View style={{ marginTop, height }}>{thumb}</View>;
  return (
    <>
      <Pressy onPress={() => setOpen(true)} label="Open the photo full screen" scaleTo={0.99} style={{ marginTop, height }}>
        {thumb}
        {/* A small "enlarge" mark, so the tap is not a secret. White on a dark chip reads on any photo. */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', right: 10, bottom: 10, width: 32, height: 32, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="expand" size={15} color="#FFFFFF" strokeWidth={2.4} />
        </View>
      </Pressy>
      {open ? <PhotoViewer path={path} visible onClose={() => setOpen(false)} /> : null}
    </>
  );
}
