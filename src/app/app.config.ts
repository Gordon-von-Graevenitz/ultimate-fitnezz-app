import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { AuthSessionService } from './core/auth/auth-session.service';
import { authInterceptor } from './core/auth/auth.interceptor';
import { LocalDataStore } from './core/data/local-data.store';
import { PwaUpdateService } from './core/pwa/pwa-update.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideAppInitializer(() => {
      inject(PwaUpdateService).start();
      const auth = inject(AuthSessionService);
      const data = inject(LocalDataStore);
      return auth.initialize().then(() =>
        auth.status() === 'authenticated'
          ? data.initializeCloudSync(auth.remoteSessionRequired, auth.email())
          : undefined,
      );
    }),
  ],
};
