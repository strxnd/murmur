import type { AppStateSnapshot } from "../../../shared/types";

export type DictationRunwayAction = "setup" | "start" | "stop" | "disabled";

export function dictationRunwayAction({
  status,
  unavailableReason,
  isActing
}: {
  status: AppStateSnapshot["session"]["status"];
  unavailableReason: string | null;
  isActing: boolean;
}): DictationRunwayAction {
  if (status === "recording") return isActing ? "disabled" : "stop";
  if (isActing || ["transcribing", "processing", "pasting"].includes(status)) return "disabled";
  return unavailableReason ? "setup" : "start";
}

export async function performDictationRunwayAction(
  action: DictationRunwayAction,
  handlers: {
    openSetup: () => void;
    startDictation: () => Promise<void>;
    stopDictation: () => Promise<void>;
  }
): Promise<void> {
  if (action === "setup") {
    handlers.openSetup();
  } else if (action === "start") {
    await handlers.startDictation();
  } else if (action === "stop") {
    await handlers.stopDictation();
  }
}
