import type { ReplacementRule } from "../../../shared/types";
import { makeClientId } from "./ids";

export function parseReplacementCsv(csv: string): ReplacementRule[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith("source,"))
    .map((line) => {
      const [source, target, category, caseSensitive, runBefore, runAfter, enabled, notes] = line
        .split(",")
        .map((part) => part.trim());
      return {
        id: makeClientId("replace"),
        source,
        target,
        category,
        caseSensitive: caseSensitive === "true",
        regex: false,
        runBeforeLlm: runBefore !== "false",
        runAfterLlm: runAfter !== "false",
        enabled: enabled !== "false",
        notes
      };
    });
}
