export interface Pricing {
  model: string;
  currency: string;
  input: number;
  cached: number;
  output: number;
}
export function validPricing(value: Pricing): boolean {
  return (
    !!value.model.trim() &&
    /^[A-Z]{3}$/.test(value.currency) &&
    [value.input, value.cached, value.output].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 1000000,
    )
  );
}
export function estimateCost(
  pricing: Pricing | undefined | null,
  model: string,
  usage: { input: number; cached: number; output: number } | undefined,
): number | null {
  if (!pricing || !usage || pricing.model !== model || !validPricing(pricing)) return null;
  return (
    (Math.max(0, usage.input - usage.cached) * pricing.input +
      Math.min(usage.input, usage.cached) * pricing.cached +
      usage.output * pricing.output) /
    1000000
  );
}
