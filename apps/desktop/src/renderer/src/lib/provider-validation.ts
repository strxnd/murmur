export interface ProviderValidationRequest {
  key: string;
  generation: number;
  fingerprint: string;
}

export class ProviderValidationGate {
  private generations = new Map<string, number>();

  begin(key: string, fingerprint: string): ProviderValidationRequest {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return { key, generation, fingerprint };
  }

  invalidate(key: string): void {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  accepts(request: ProviderValidationRequest, currentFingerprint: string | undefined): boolean {
    return this.generations.get(request.key) === request.generation && currentFingerprint === request.fingerprint;
  }
}

export function providerValidationFingerprint(value: unknown): string {
  return stableSerialize(value);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}
