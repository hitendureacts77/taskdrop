import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ActivityIndicator } from 'react-native';
import { cardSurface, formatINR } from './ui';
import { EmptyState, LoadFailed, PrimaryButton, Shimmer } from './kit';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import { PROMOTABLE_PAGE, promotableTasksPage, type PromotablePost, type TaskKind } from '../data/api';
import { fillShare, fillText, mergePromotable } from '../lib/promotePick';
import { reportError } from '../lib/errors';

/**
 * The posts a person can promote, as small cards to tap: open, with fewer workers than wanted. The 10 newest
 * show first; "Show more" asks the server for the next 10 each time. No typing is needed to choose one.
 */
export function PromotePicker({ kind, onPick, onPost }: { kind: TaskKind; onPick: (p: PromotablePost) => void; onPost: () => void }) {
  const t = useTheme();
  const [items, setItems] = useState<PromotablePost[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  // How many rows the server has been asked for, so a skipped duplicate never shifts the next page.
  const offset = useRef(0);
  const service = kind === 'service';

  const load = useCallback(async () => {
    setFailed(false);
    offset.current = 0;
    try {
      const page = await promotableTasksPage(kind, 0, PROMOTABLE_PAGE);
      offset.current = PROMOTABLE_PAGE;
      setItems(mergePromotable([], page.items));
      setHasMore(page.hasMore);
    } catch (e) {
      reportError(e, 'promote-pick');
      setFailed(true);
    }
  }, [kind]);
  useEffect(() => {
    void load();
  }, [load]);

  const showMore = async () => {
    if (more) return;
    setMore(true);
    try {
      const page = await promotableTasksPage(kind, offset.current, PROMOTABLE_PAGE);
      offset.current += PROMOTABLE_PAGE;
      setItems((cur) => mergePromotable(cur ?? [], page.items));
      setHasMore(page.hasMore);
    } catch (e) {
      reportError(e, 'promote-pick-more');
      setFailed(true);
    } finally {
      setMore(false);
    }
  };

  if (failed && !items) return <LoadFailed title={service ? 'Couldn’t load your services' : 'Couldn’t load your tasks'} onRetry={() => void load()} />;
  if (!items) {
    return (
      <View style={{ gap: 10 }}>
        <Shimmer height={66} />
        <Shimmer height={66} />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon="bolt"
        title={service ? 'No service to promote' : 'Nothing to promote right now'}
        body={
          service
            ? 'Only your own open services can be promoted. List one and it will show up here.'
            : 'Only your open tasks that still need a worker can be promoted. Post a task and it will show up here.'
        }
        actionLabel={service ? 'List a service' : 'Post a task'}
        onAction={onPost}
      />
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {items.map((p) => {
        const crew = !service && p.wanted > 1;
        return (
          <Pressable
            key={p.id}
            onPress={() => onPick(p)}
            accessibilityRole="button"
            accessibilityLabel={`Promote ${p.title}, ${fillText(p)}`}
            style={({ pressed }) => ({
              ...cardSurface(t, 14),
              paddingVertical: 11,
              paddingHorizontal: 13,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>
                {p.title}
              </RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                {[p.category ? p.category.replace(/_/g, ' ') : '', formatINR(p.benchmark_minor)].filter(Boolean).join(' · ')}
              </RNText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 }}>
                {crew ? (
                  <View style={{ width: 54, height: 5, borderRadius: 3, backgroundColor: t.colors.surface2, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.round(fillShare(p) * 100)}%`, height: 5, backgroundColor: t.colors.accent }} />
                  </View>
                ) : null}
                <RNText style={tx('700', 11, t.colors.accentDeep)}>{fillText(p)}</RNText>
              </View>
            </View>
            <RNText style={tx('800', 12, t.colors.accentDeep)}>Promote ›</RNText>
          </Pressable>
        );
      })}
      {hasMore ? (
        <View style={{ marginTop: 2 }}>
          {more ? (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator size="small" color={t.colors.muted} />
            </View>
          ) : (
            <PrimaryButton label="Show more" tone="quiet" onPress={() => void showMore()} />
          )}
        </View>
      ) : null}
    </View>
  );
}
