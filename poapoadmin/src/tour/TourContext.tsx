import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAIN_TOUR_STEPS, type TourStep } from "./tourSteps";
import { readTourStatus, writeTourStatus } from "./tourStorage";
import TourOverlay from "./TourOverlay";

type Phase = "idle" | "offer" | "tour";

interface TourContextValue {
  active: boolean;
  start: () => void;
}

const TourContext = createContext<TourContextValue>({ active: false, start: () => undefined });
export const useTour = () => useContext(TourContext);

interface Props {
  /** Stable identifier of the signed-in user; null disables the tour. */
  userId: string | null;
  /** True when the offer must not interrupt the current page (e.g. an editor). */
  suppressOffer?: boolean;
  steps?: TourStep[];
  children: ReactNode;
}

export function TourProvider({ userId, suppressOffer = false, steps = MAIN_TOUR_STEPS, children }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [index, setIndex] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const offered = useRef<string | null>(null);

  // First-login offer: once per user per mount, only if never dismissed or completed.
  useEffect(() => {
    if (!userId || suppressOffer || phase !== "idle" || offered.current === userId) return;
    if (readTourStatus(userId) !== null) { offered.current = userId; return; }
    offered.current = userId;
    returnFocus.current = null;
    setPhase("offer");
  }, [userId, suppressOffer, phase]);

  const remember = useCallback(() => {
    const el = document.activeElement;
    returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null;
  }, []);

  const start = useCallback(() => {
    if (!userId) return;
    if (phase === "idle") remember();
    setIndex(0);
    setPhase("tour");
  }, [userId, phase, remember]);

  const close = useCallback((status: "completed" | "dismissed") => {
    if (userId) writeTourStatus(userId, status);
    setPhase("idle");
    const el = returnFocus.current;
    returnFocus.current = null;
    // Wait for the overlay to unmount and the page to become interactive again.
    requestAnimationFrame(() => {
      if (el && el.isConnected) { el.focus(); return; }
      const main = document.querySelector<HTMLElement>("main");
      if (main) { main.tabIndex = -1; main.focus({ preventScroll: true }); }
    });
  }, [userId]);

  const value = useMemo(() => ({ active: phase !== "idle", start }), [phase, start]);

  return <TourContext.Provider value={value}>
    {children}
    {phase !== "idle" && <TourOverlay
      mode={phase}
      steps={steps}
      index={index}
      onStart={() => { setIndex(0); setPhase("tour"); }}
      onPrev={() => setIndex((i) => Math.max(0, i - 1))}
      onNext={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}
      onSkip={() => close("dismissed")}
      onFinish={() => close("completed")}
    />}
  </TourContext.Provider>;
}
