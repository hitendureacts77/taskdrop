import { ScrollView, Text as RNText, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMyArea } from '../lib/useMyArea';
import { setJobFilters, useJobFilters } from '../lib/jobFiltersStore';
import { Icon, type IconName } from './Icon';
import { Pressy, tx } from './primitives';

type Chip = { key: string; icon: IconName; label: string; hint: string; open: () => void };

/**
 * A row of shortcuts to the map's features on Home, for Hire and Earn alike: each chip opens the full map
 * already on that layer (Hire sees helpers, Earn sees jobs; the map keeps one side per mode). The map's own
 * layer switch is unchanged. Earn's Remote chip sets the shared Find work filter to remote work.
 */
export function MapShortcuts({ worker }: { worker: boolean }) {
  const t = useTheme();
  const { go } = useNav();
  const { area } = useMyArea();
  const filters = useJobFilters();
  const centre = area ? { lat: area.lat, lng: area.lng } : undefined;
  // With no area yet the map route could only say "turn on location"; Explore's map has the area picker,
  // and it shows this mode's side (Hire: helpers, Earn: jobs) with the same shared filters.
  const openMap = (mode: 'jobs' | 'people') => (centre ? go('nearMap', { mode, centre }) : go('explore'));

  const chips: Chip[] = worker
    ? [
        {
          key: 'jobs',
          icon: 'pin',
          label: 'Jobs near you',
          hint: 'Open the map on jobs near you',
          open: () => {
            // The remote filter shows no pins around you, so a chip that says "near you" clears it first.
            if (filters.work === 'remote') setJobFilters({ ...filters, work: 'all' });
            openMap('jobs');
          },
        },
        {
          key: 'remote',
          icon: 'globe',
          label: 'Remote work',
          hint: 'Open the map on remote work you can do from anywhere',
          open: () => {
            if (filters.work !== 'remote') setJobFilters({ ...filters, work: 'remote' });
            openMap('jobs');
          },
        },
        { key: 'full', icon: 'map', label: 'Full map', hint: 'Open the full map', open: () => go('explore') },
      ]
    : [
        { key: 'helpers', icon: 'users', label: 'Helpers near you', hint: 'Open the map on helpers near you', open: () => openMap('people') },
        { key: 'full', icon: 'map', label: 'Full map', hint: 'Open the full map', open: () => go('explore') },
      ];

  return (
    <View testID="home-map-shortcuts" style={{ marginTop: 14 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {chips.map((c) => (
          <Pressy
            key={c.key}
            onPress={c.open}
            label={c.hint}
            scaleTo={0.96}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.colors.line,
              backgroundColor: t.colors.surface,
            }}
          >
            <Icon name={c.icon} size={15} color={t.colors.accentDeep} />
            <RNText style={tx('700', 13, t.colors.ink)} numberOfLines={1}>
              {c.label}
            </RNText>
          </Pressy>
        ))}
      </ScrollView>
    </View>
  );
}
