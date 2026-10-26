export type AbandonReason = "pagehide" | "unmount";
export interface AbandonPayload { stepIndex: number; reason: AbandonReason }

/**
 * Émet au plus un `quiz_abandon` par parcours : uniquement à la fermeture/au démontage d'un quiz démarré
 * et non terminé. Les changements de question, les re-rendus et la complétion n'en émettent jamais.
 * La transmission reste au mieux (sendBeacon) : un abandon peut ne pas être reçu.
 */
export function createAbandonTracker(send: (payload: AbandonPayload) => void) {
  let started = false;
  let completed = false;
  let sent = false;
  let stepIndex = 0;
  return {
    start() { started = true; completed = false; sent = false; },
    setStep(index: number) { stepIndex = index; },
    complete() { completed = true; },
    // Redémarrage volontaire : nouveau parcours, aucun abandon pour l'ancien (déjà terminé).
    reset() { started = false; completed = false; sent = false; stepIndex = 0; },
    // Retour depuis le cache de navigation (bfcache) : le parcours reprend, un nouvel abandon redevient possible.
    reopen() { sent = false; },
    leave(reason: AbandonReason) {
      if (!started || completed || sent) return;
      sent = true;
      send({ stepIndex, reason });
    },
  };
}
