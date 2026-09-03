import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then((registration) => {
        const notifyUpdate = (worker: ServiceWorker | null) => {
          if (worker && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent("sw-update-found", { detail: worker }));
          }
        };
        // Önceki açılışta beklemeye geçmiş worker varsa banner kaçmış olabilir
        notifyUpdate(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            if (newWorker.state === "installed") {
              notifyUpdate(newWorker);
            }
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed") {
                notifyUpdate(newWorker);
              }
            });
          }
        });
        // Periyodik + sekme öne gelince güncelleme denetle
        const checkUpdate = () => {
          void registration.update().catch(() => {
            // Çevrimdışıyken sessiz geç
          });
        };
        window.setInterval(checkUpdate, 60 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) checkUpdate();
        });
      })
      .catch(() => {
        // Uygulama servis işçisi olmadan da çevrim içi çalışmaya devam eder.
      });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}
