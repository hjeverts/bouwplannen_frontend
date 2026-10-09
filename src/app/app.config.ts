import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { LocalProjectStorage, PROJECT_STORAGE } from './model/storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Projects are kept in the browser; SyncService keeps them in step with the server when logged in.
    { provide: PROJECT_STORAGE, useClass: LocalProjectStorage },
    // Makes the app start without a connection (on site) and installable on tablet and phone.
    // Not inside an embedded preview, where service workers are not allowed.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && typeof window !== 'undefined' && window.self === window.top,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
