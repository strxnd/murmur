import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import type { PillStateSnapshot } from "../../../shared/types";
import { cn } from "../lib/cn";
import { murmurClient } from "../lib/murmur-client";

const barWeights = [0.36, 0.56, 0.78, 1, 0.78, 0.56, 0.36];
const idleBarScale = 0.22;
const levelSettleThreshold = 0.004;
const levelSmoothing = 0.34;

export function shouldAnimateRecordingLevels(isRecording: boolean, prefersReducedMotion: boolean): boolean {
  return isRecording && !prefersReducedMotion;
}

const barStyles = barWeights.map(
  (_, index) =>
    ({
      "--bar-delay": `${index * 70}ms`,
      "--bar-recording-delay": `${index * -80}ms`,
      "--bar-scale": idleBarScale.toString()
    }) as CSSProperties
);

export function RecordingPill({ state }: { state: PillStateSnapshot }): JSX.Element {
  const { id: sessionId, status } = state.session;
  const isRecording = status === "recording";
  const isProcessing = status === "transcribing" || status === "processing";
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const targetLevelRef = useRef(0);
  const renderedLevelRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = (): void => setPrefersReducedMotion(query.matches);
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const stopAnimation = (): void => {
      if (animationFrameRef.current === null) return;
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };

    const writeLevel = (level: number): void => {
      for (let index = 0; index < barWeights.length; index += 1) {
        const bar = barRefs.current[index];
        if (!bar) continue;
        const scale = Math.min(1, idleBarScale + level * barWeights[index] * (1 - idleBarScale));
        bar.style.setProperty("--bar-scale", scale.toFixed(3));
      }
    };

    if (!shouldAnimateRecordingLevels(isRecording, prefersReducedMotion)) {
      stopAnimation();
      targetLevelRef.current = 0;
      renderedLevelRef.current = 0;
      writeLevel(0);
      return stopAnimation;
    }

    targetLevelRef.current = 0;
    renderedLevelRef.current = 0;
    writeLevel(0);

    const animateLevel = (): void => {
      const currentLevel = renderedLevelRef.current;
      const targetLevel = targetLevelRef.current;
      const nextLevel = currentLevel + (targetLevel - currentLevel) * levelSmoothing;
      const settled = Math.abs(nextLevel - targetLevel) <= levelSettleThreshold;
      const renderedLevel = settled ? targetLevel : nextLevel;

      renderedLevelRef.current = renderedLevel;
      writeLevel(renderedLevel);

      animationFrameRef.current = settled ? null : window.requestAnimationFrame(animateLevel);
    };

    const startAnimation = (): void => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(animateLevel);
    };

    const unsubscribe = murmurClient.onRecordingLevel((payload) => {
      if (payload.sessionId !== sessionId) return;
      targetLevelRef.current = payload.level;
      startAnimation();
    });

    return () => {
      unsubscribe();
      stopAnimation();
    };
  }, [isRecording, prefersReducedMotion, sessionId]);

  const ariaLabel = isRecording ? "Murmur recording" : isProcessing ? "Murmur processing" : "Murmur idle";

  return (
    <div className="recording-pill-shell">
      <div className="recording-pill" role="status" aria-label={ariaLabel}>
        <div
          className={cn(
            "recording-wave",
            isRecording && "recording-wave--recording",
            isProcessing && "recording-wave--processing",
            !isRecording && !isProcessing && "recording-wave--muted"
          )}
        >
          {barStyles.map((style, index) => (
            <span
              key={`recording-bar-${index}`}
              ref={(element) => {
                barRefs.current[index] = element;
              }}
              className="recording-wave__bar"
              style={style}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
