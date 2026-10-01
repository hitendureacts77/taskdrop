/**
 * Web build: the payment page opens in its own browser tab (claimed inside the
 * tap, see EscrowScreen), so there is no in-app sheet to draw here.
 */
export function PaymentSheet(_props: { url: string | null; visible: boolean; onClose: () => void }) {
  return null;
}
