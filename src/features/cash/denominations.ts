export const DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

export type DenominationInputRefs = React.MutableRefObject<Record<number, HTMLInputElement | null>>;

export function normalizeCount(value: string | number | null | undefined): number {
  return Math.max(0, Number(value) || 0);
}

function focusDenominationInput(inputRefs: DenominationInputRefs, denomination: number, direction: -1 | 1): void {
  const currentIndex = DENOMINATIONS.indexOf(denomination);
  const nextDenomination = DENOMINATIONS[currentIndex + direction];
  if (!nextDenomination) return;
  inputRefs.current[nextDenomination]?.focus();
  inputRefs.current[nextDenomination]?.select();
}

export function handleDenominationKeyDown(
  event: React.KeyboardEvent<HTMLInputElement>,
  denomination: number,
  options: {
    inputRefs: DenominationInputRefs;
    updateCount: (denomination: number, delta: number) => void;
    readOnly?: boolean;
  }
): void {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusDenominationInput(options.inputRefs, denomination, -1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusDenominationInput(options.inputRefs, denomination, 1);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (!options.readOnly) options.updateCount(denomination, -1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (!options.readOnly) options.updateCount(denomination, 1);
  }
}
