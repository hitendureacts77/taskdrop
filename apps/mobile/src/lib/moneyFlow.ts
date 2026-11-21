/**
 * Whether the app is on the Plan B money flow (pay per task), known without React so the data layer can ask.
 * Set by useMoneyMode whenever the server's answer arrives; false until then and whenever signed out, which
 * is the wallet flow, so nothing changes by accident. The server decides every money rule either way.
 */
let planB = false;

export const isPlanB = (): boolean => planB;
export function setPlanB(on: boolean): void {
  planB = on;
}
