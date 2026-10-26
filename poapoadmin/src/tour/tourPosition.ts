import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

export interface Box { top: number; left: number; width: number; height: number }
export interface Placement { card: { top: number; left: number } | null; spot: Box | null }

const GAP = 14;
const MARGIN = 12;
const PAD = 6;

/** Looks the target up through the dedicated data-tour attribute, never through styling selectors. */
export function findTarget(id?: string): HTMLElement | null {
  if (!id) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

/** Pure placement: first side where the card fits in the viewport, otherwise null (centered fallback). */
export function computePlacement(target: Box | null, card: { width: number; height: number }, vw: number, vh: number): Placement {
  if (!target) return { card: null, spot: null };
  const spot = { top: target.top - PAD, left: target.left - PAD, width: target.width + PAD * 2, height: target.height + PAD * 2 };
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), vw - card.width - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(MARGIN, y), vh - card.height - MARGIN);
  const candidates = [
    { top: clampY(spot.top), left: spot.left + spot.width + GAP },
    { top: spot.top + spot.height + GAP, left: clampX(spot.left) },
    { top: clampY(spot.top), left: spot.left - GAP - card.width },
    { top: spot.top - GAP - card.height, left: clampX(spot.left) },
  ];
  const fits = (c: { top: number; left: number }) =>
    c.left >= MARGIN && c.top >= MARGIN && c.left + card.width <= vw - MARGIN && c.top + card.height <= vh - MARGIN;
  const chosen = candidates.find(fits);
  return { card: chosen ?? null, spot };
}

/** Measures the current target and card, and re-measures on resize, scroll and target size changes. */
export function usePlacement(targetId: string | undefined, cardRef: RefObject<HTMLElement | null>, stepKey: string): Placement {
  const [placement, setPlacement] = useState<Placement>({ card: null, spot: null });

  const measure = useCallback(() => {
    const card = cardRef.current;
    const el = findTarget(targetId);
    if (!card || !el) { setPlacement((p) => (p.spot === null && p.card === null ? p : { card: null, spot: null })); return; }
    const r = el.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    setPlacement(computePlacement({ top: r.top, left: r.left, width: r.width, height: r.height }, { width: c.width, height: c.height }, window.innerWidth, window.innerHeight));
  }, [targetId, cardRef]);

  useLayoutEffect(() => {
    findTarget(targetId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
  }, [targetId, stepKey, measure]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const target = findTarget(targetId);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (target) observer?.observe(target);
    if (cardRef.current) observer?.observe(cardRef.current);
    // The target can appear after a route change or a late render: retry briefly.
    const retry = window.setTimeout(schedule, 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      observer?.disconnect();
    };
  }, [targetId, stepKey, measure, cardRef]);

  return placement;
}
