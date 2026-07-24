import { describe, expect, it } from "vitest";
import { ProviderValidationGate, providerValidationFingerprint } from "./provider-validation";

describe("ProviderValidationGate", () => {
  it("rejects a late validation result after credentials change", () => {
    const gate = new ProviderValidationGate();
    const providerA = { id: "provider", baseUrl: "https://a.example/v1", apiKey: "key-a" };
    const providerB = { id: "provider", baseUrl: "https://b.example/v1", apiKey: "key-b" };
    const request = gate.begin("llm:provider", providerValidationFingerprint(providerA));

    expect(gate.accepts(request, providerValidationFingerprint(providerB))).toBe(false);
  });

  it("rejects an older generation even when a new request tests the same values", () => {
    const gate = new ProviderValidationGate();
    const fingerprint = providerValidationFingerprint({ id: "provider", apiKey: "key-a" });
    const first = gate.begin("llm:provider", fingerprint);
    const second = gate.begin("llm:provider", fingerprint);

    expect(gate.accepts(first, fingerprint)).toBe(false);
    expect(gate.accepts(second, fingerprint)).toBe(true);
  });

  it("uses stable fingerprints independent of object key order", () => {
    expect(providerValidationFingerprint({ apiKey: "key-a", baseUrl: "https://example.com" })).toBe(
      providerValidationFingerprint({ baseUrl: "https://example.com", apiKey: "key-a" })
    );
  });
});
