import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import { cn } from "../lib/cn";
import { murmurClient } from "../lib/murmur-client";

const barWeights = [0.36, 0.56, 0.78, 1, 0.78, 0.56, 0.36];

export function RecordingPill({ state }: { state: AppStateSnapshot }): JSX.Element {
  const { id: sessionId, status } = state.session;
  const isRecording = status === "recording";
  const isProcessing = status === "transcribing" || status === "processing";
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!isRecording) {
      setLevel(0);
      return undefined;
    }

    setLevel(0);
    return murmurClient.onRecordingLevel((payload) => {
      if (payload.sessionId !== sessionId) return;
      setLevel(payload.level);
    });
  }, [isRecording, sessionId]);

  const barScales = useMemo(
    () => barWeights.map((weight) => Math.min(1, 0.22 + level * weight * 0.78)),
    [level]
  );
  const ariaLabel = isRecording ? "Murmur recording" : isProcessing ? "Murmur processing" : "Murmur idle";

  return (
    <div className="recording-pill-shell">
      <div className="recording-pill" role="status" aria-label={ariaLabel}>
        <div className={cn("recording-wave", isProcessing && "recording-wave--processing", !isRecording && !isProcessing && "recording-wave--muted")}>
          {barScales.map((scale, index) => (
            <span
              key={`recording-bar-${index}`}
              className="recording-wave__bar"
              style={
                {
                  "--bar-delay": `${index * 70}ms`,
                  "--bar-scale": scale.toFixed(3)
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
