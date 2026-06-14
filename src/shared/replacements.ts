import type { ReplacementRule } from "./types";

export function applyReplacements(input: string, rules: ReplacementRule[], phase: "before" | "after"): string {
  return rules
    .filter((rule) => rule.enabled)
    .filter((rule) => (phase === "before" ? rule.runBeforeLlm : rule.runAfterLlm))
    .reduce((text, rule) => {
      if (!rule.source) return text;

      if (rule.regex) {
        try {
          const flags = rule.caseSensitive ? "g" : "gi";
          return text.replace(new RegExp(rule.source, flags), rule.target);
        } catch {
          return text;
        }
      }

      const escaped = escapeRegExp(rule.source);
      const flags = rule.caseSensitive ? "g" : "gi";
      return text.replace(new RegExp(escaped, flags), rule.target);
    }, input);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
