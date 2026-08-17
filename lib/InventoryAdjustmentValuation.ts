export type AdjustmentDirection = 'increase' | 'decrease';

export interface ReverseAdjustmentValueInput {
  currentValue: number;
  direction: AdjustmentDirection;
  adjustmentCost: number;
  basisDelta: number;
  averageBefore: number;
}

export function reverseAdjustmentValue(input: ReverseAdjustmentValueInput): number {
  const delta = input.direction === 'increase'
    ? input.adjustmentCost
    : input.basisDelta * input.averageBefore;
  return input.direction === 'increase'
    ? input.currentValue - delta
    : input.currentValue + delta;
}

export interface ApplyAdjustmentValueInput {
  baseValue: number;
  baseBasis: number;
  direction: AdjustmentDirection;
  adjustmentCost: number;
  basisDelta: number;
  fallbackAverage: number;
}

export function applyAdjustmentValue(input: ApplyAdjustmentValueInput): {
  valueAfter: number;
  averageUsed: number;
} {
  const averageUsed = input.baseBasis > 0
    ? Math.max(0, input.baseValue) / input.baseBasis
    : input.fallbackAverage;
  const delta = input.direction === 'increase'
    ? input.adjustmentCost
    : input.basisDelta * averageUsed;
  return {
    valueAfter: input.direction === 'increase'
      ? input.baseValue + delta
      : input.baseValue - delta,
    averageUsed,
  };
}
