/**
 * A QR code (web only, design D17): the real component is QrCode.web.tsx, so
 * the QR library never ends up in the phone apps.
 */
export function QrCode(_props: { value: string; size: number; label?: string }) {
  return null;
}
