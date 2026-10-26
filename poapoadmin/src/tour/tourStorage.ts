/**
 * Versioned, per-user tour status kept in localStorage.
 * Limits: specific to one browser, not synced across devices, and reset when local data is cleared
 * (the offer is then shown again once). Bump TOUR_VERSION to re-offer the tour after a major change.
 */
export type TourStatus = "completed" | "dismissed";

export const TOUR_VERSION = 1;
const key = (userId: string) => `poapo_tour_v${TOUR_VERSION}:${userId}`;

export function readTourStatus(userId: string): TourStatus | null {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { status?: string };
    return parsed.status === "completed" || parsed.status === "dismissed" ? parsed.status : null;
  } catch {
    return null;
  }
}

export function writeTourStatus(userId: string, status: TourStatus): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify({ status, at: new Date().toISOString() }));
  } catch {
    /* storage unavailable: the offer may reappear, which is acceptable */
  }
}
