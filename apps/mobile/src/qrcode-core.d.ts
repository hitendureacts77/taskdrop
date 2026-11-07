/**
 * The `qrcode` package ships no types of its own and its main entry pulls in
 * Node-only code. The web QR (components/QrCode.web.tsx) uses only its pure
 * encoder, which gives the grid of dark and light squares to draw ourselves.
 */
declare module 'qrcode/lib/core/qrcode' {
  export type QrSymbol = {
    modules: { size: number; get(row: number, col: number): number | boolean };
  };
  export function create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): QrSymbol;
}
