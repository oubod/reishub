(function () {
  if (window.__resihubPwaUpdaterActive) return;
  window.__resihubPwaUpdaterActive = true;

  const script = document.currentScript;
  const swUrl = script?.dataset.sw || "sw.js?v=resihub-20260626-3";
  const promptText =
    script?.dataset.prompt ||
    "Nouvelle mise à jour RésiHub disponible. Appuyez sur OK pour l'installer.";

  if (!("serviceWorker" in navigator)) return;
  if (!["http:", "https:"].includes(window.location.protocol)) return;

  let reloading = false;
  let promptedWorker = null;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  function promptForUpdate(worker) {
    if (!worker || promptedWorker === worker) return;
    promptedWorker = worker;
    if (window.confirm(promptText)) {
      worker.postMessage({ type: "SKIP_WAITING" });
    }
  }

  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        promptForUpdate(registration.waiting);
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            promptForUpdate(worker);
          }
        });
      });

      return registration.update();
    })
    .catch(() => {});
})();
