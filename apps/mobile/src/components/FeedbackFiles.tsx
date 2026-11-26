import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ActivityIndicator, Linking } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { Icon, type IconName } from './Icon';
import { PhotoViewer } from './PhotoViewer';
import { tx } from './primitives';
import {
  FEEDBACK_FILES_MAX,
  FEEDBACK_PICK_QUALITY,
  MediaError,
  feedbackTooBig,
  imageSource,
  pickFeedbackPdf,
  pickMedia,
  removeMedia,
  signedMediaUrl,
  signedMediaUrls,
  uploadFeedbackFile,
  type FeedbackFile,
} from '../lib/media';
import { shrinkPhoto } from '../lib/photoShrink';

/**
 * Photos and PDFs on feedback (plan 1.19 row L, migration 206).
 *
 * FeedbackAttach is the picker inside "Send feedback" and "Suggest an idea":
 * up to three files, each uploaded the moment it is chosen, so the Send button
 * only has to save the list. Removing one deletes the upload too.
 * FeedbackFileList shows the files on an idea: photos as small tiles that open
 * full size, PDFs as a named chip that opens the file. Every link is signed
 * and short-lived; the server decides who may open what.
 */

const TILE = 64;

function useThumbs(files: FeedbackFile[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = files
    .filter((f) => f.kind === 'image')
    .map((f) => f.path)
    .join('|');
  useEffect(() => {
    const paths = key ? key.split('|') : [];
    if (!paths.length) return;
    let alive = true;
    void signedMediaUrls(paths, 'thumb').then((u) => alive && setUrls(u));
    return () => {
      alive = false;
    };
  }, [key]);
  return urls;
}

function Tile({
  file,
  thumb,
  onPress,
  onRemove,
}: {
  file: FeedbackFile;
  thumb?: string;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const t = useTheme();
  const label = file.kind === 'image' ? `Photo ${file.name}` : `PDF ${file.name}`;
  return (
    <View style={{ width: file.kind === 'image' ? TILE : 150, height: TILE }}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? `Open ${label}` : label}
        style={({ pressed }) => ({
          flex: 1,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.colors.line,
          backgroundColor: t.colors.surface,
          overflow: 'hidden',
          opacity: pressed ? 0.8 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: file.kind === 'image' ? 'center' : 'flex-start',
          gap: 8,
          paddingHorizontal: file.kind === 'image' ? 0 : 10,
        })}
      >
        {file.kind === 'image' ? (
          thumb ? (
            <Image source={imageSource(thumb)} style={{ width: TILE, height: TILE }} contentFit="cover" accessibilityIgnoresInvertColors />
          ) : (
            <Icon name="camera" size={22} color={t.colors.muted} />
          )
        ) : (
          <>
            <Icon name="file" size={22} color={t.colors.accentDeep} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <RNText style={tx('700', 12, t.colors.ink)} numberOfLines={2}>
                {file.name}
              </RNText>
              <RNText style={tx('600', 10, t.colors.muted, { marginTop: 2 })}>PDF</RNText>
            </View>
          </>
        )}
      </Pressable>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.colors.ink,
          }}
        >
          <Icon name="close" size={12} color={t.colors.bg} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AddButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: t.colors.line,
        backgroundColor: t.colors.surface,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Icon name={icon} size={16} color={t.colors.ink} />
      <RNText style={tx('700', 13, t.colors.ink)}>{label}</RNText>
    </Pressable>
  );
}

/** The picker: up to three photos or PDFs. `onBusy` is true while a file is uploading, so the form can wait. */
export function FeedbackAttach({
  files,
  onChange,
  onBusy,
  note,
}: {
  files: FeedbackFile[];
  onChange: (next: FeedbackFile[]) => void;
  onBusy?: (busy: boolean) => void;
  /** A line under the buttons, e.g. who will see the files. */
  note?: string;
}) {
  const t = useTheme();
  const [uploading, setUploading] = useState(false);
  // Shown in the sheet itself, under the buttons: a toast would sit behind the sheet.
  const [error, setError] = useState<string | null>(null);
  const thumbs = useThumbs(files);
  const full = files.length >= FEEDBACK_FILES_MAX;

  const run = async (pick: () => Promise<FeedbackFile | null>) => {
    if (full || uploading) return;
    setError(null);
    try {
      // The picker opens first (it must follow the press straight away); the upload starts once something is chosen.
      const added = await pick();
      if (added) onChange([...files, added]);
    } catch (e) {
      setError(e instanceof MediaError || e instanceof Error ? e.message : 'Could not attach that file');
    } finally {
      setUploading(false);
      onBusy?.(false);
    }
  };

  const started = () => {
    setUploading(true);
    onBusy?.(true);
  };

  const addPhoto = () =>
    void run(async () => {
      const picked = await pickMedia('image', 'library', FEEDBACK_PICK_QUALITY);
      if (!picked) return null;
      started();
      // Made smaller first (1600 px, JPEG): only small photos are stored. When that cannot be done here
      // (an older installed app), the photo goes up as picked and the 1 MB limit still holds.
      const photo = (await shrinkPhoto(picked.uri, picked)) ?? { uri: picked.uri, mimeType: picked.mimeType, bytes: picked.bytes };
      const tooBig = feedbackTooBig('image', photo.bytes);
      if (tooBig) throw new MediaError(tooBig);
      return uploadFeedbackFile({ ...photo, name: 'Photo' }, 'image');
    });

  const addPdf = () =>
    void run(async () => {
      const picked = await pickFeedbackPdf();
      if (!picked) return null;
      started();
      return uploadFeedbackFile(picked, 'file');
    });

  const remove = (f: FeedbackFile) => {
    setError(null);
    onChange(files.filter((x) => x.path !== f.path));
    void removeMedia(f.path);
  };

  return (
    <View style={{ marginTop: 14 }}>
      {files.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10, paddingTop: 6 }}>
          {files.map((f) => (
            <Tile key={f.path} file={f} thumb={thumbs[f.path]} onRemove={() => remove(f)} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <AddButton icon="camera" label="Add photo" onPress={addPhoto} disabled={full || uploading} />
        <AddButton icon="paperclip" label="Add PDF" onPress={addPdf} disabled={full || uploading} />
        {uploading ? <ActivityIndicator size="small" color={t.colors.muted} /> : null}
      </View>
      {error ? (
        <RNText accessibilityRole="alert" accessibilityLiveRegion="polite" style={tx('600', 13, t.colors.signalDeep, { marginTop: 8, lineHeight: 18 })}>
          {error}
        </RNText>
      ) : null}
      <RNText style={tx('400', 11, t.colors.muted, { marginTop: 8 })}>
        {full
          ? 'That is the most you can attach: 3 files.'
          : `Optional. Up to ${FEEDBACK_FILES_MAX} photos or PDFs. Photos are made smaller before they are sent. PDFs up to 2 MB.`}
        {note ? ` ${note}` : ''}
      </RNText>
    </View>
  );
}

/** The files on an idea, to look at. Photos open full size; a PDF opens in the browser or a PDF app. */
export function FeedbackFileList({ files }: { files: FeedbackFile[] }) {
  const t = useTheme();
  const { flash } = useActions();
  const thumbs = useThumbs(files);
  const [viewing, setViewing] = useState<string | null>(null);
  if (!files.length) return null;

  const open = async (f: FeedbackFile) => {
    if (f.kind === 'image') {
      setViewing(f.path);
      return;
    }
    const url = await signedMediaUrl(f.path, 'full');
    if (url) void Linking.openURL(url);
    else flash('Could not open that file');
  };

  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon name="paperclip" size={14} color={t.colors.muted} />
        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1 })}>ATTACHED</RNText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {files.map((f) => (
          <Tile key={f.path} file={f} thumb={thumbs[f.path]} onPress={() => void open(f)} />
        ))}
      </View>
      {viewing ? <PhotoViewer path={viewing} visible onClose={() => setViewing(null)} /> : null}
    </View>
  );
}
