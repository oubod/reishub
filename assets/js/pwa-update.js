(function () {
  if (window.__resihubPwaUpdaterActive) return;
  window.__resihubPwaUpdaterActive = true;

  const script = document.currentScript;
  const swUrl = script?.dataset.sw || "sw.js?v=resihub-20260829-1";

  if (!("serviceWorker" in navigator)) return;
  if (!["http:", "https:"].includes(window.location.protocol)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  function activateUpdate(worker) {
    worker?.postMessage({ type: "SKIP_WAITING" });
  }

  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      activateUpdate(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed") activateUpdate(worker);
        });
      });

      const checkForUpdate = () => registration.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
      window.addEventListener("pageshow", checkForUpdate);
      checkForUpdate();
    })
    .catch(() => {});
})();
