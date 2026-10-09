import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { LocalProjectStorage, PROJECT_STORAGE } from './model/storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Swap for an HTTP implementation once the .NET backend exists.
    { provide: PROJECT_STORAGE, useClass: LocalProjectStorage },
  ],
};
