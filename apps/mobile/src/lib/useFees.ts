import { useEffect, useState } from 'react';
import { FEES } from '@taskdrop/rules';
import { platformFees, type Fees } from '../data/extras';

/**
 * The fee rates as the server has them now (the admin can change them). A
 * preview on screen starts from the built-in rules and switches to the live
 * numbers as soon as the `platformFees` operation answers; it is only a
 * preview, the server prices the real charge.
 */
const BUILT_IN: Fees = {
  commission: FEES.WORKER_COMMISSION_PCT,
  posterFee: FEES.POSTER_SERVICE_FEE_PCT,
  clearingDays: 7,
  cancelFine: FEES.POST_START_CANCEL_PENALTY_PCT,
};

let latest: Fees | null = null;

export function useFees(): Fees {
  const [fees, setFees] = useState<Fees>(latest ?? BUILT_IN);
  useEffect(() => {
    let alive = true;
    void platformFees().then((f) => {
      latest = f;
      if (alive) setFees(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  return fees;
}
