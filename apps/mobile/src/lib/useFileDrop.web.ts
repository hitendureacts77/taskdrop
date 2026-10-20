import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';

/**
 * Drag-and-drop of a file onto a view, web build. react-native-web does not
 * pass drag events through to a View, so this attaches them to the DOM node
 * behind the ref. Only a drag that carries files counts, so dragging selected
 * text around the page does not light the drop area up.
 */
export function useFileDrop({ enabled = true, onFile }: { enabled?: boolean; onFile: (file: File) => void }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [over, setOver] = useState(false);
  // dragenter/dragleave also fire for every child the pointer crosses.
  const depth = useRef(0);
  const latest = useRef(onFile);
  latest.current = onFile;

  const ref = useCallback((n: View | null) => setNode(n as unknown as HTMLElement | null), []);

  useEffect(() => {
    if (!node || !enabled) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    };
    const overHandler = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Without this the browser refuses the drop and opens the file instead.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) latest.current(file);
    };

    node.addEventListener('dragenter', enter);
    node.addEventListener('dragover', overHandler);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragenter', enter);
      node.removeEventListener('dragover', overHandler);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
      depth.current = 0;
      setOver(false);
    };
  }, [node, enabled]);

  return { ref, over };
}
