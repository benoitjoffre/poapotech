import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

/** Avertit avant de quitter la page (rechargement, fermeture, lien interne) tant que `active` est vrai. */
export function useLeaveGuard(active: boolean, message: string) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    active && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [active, message]);
}
