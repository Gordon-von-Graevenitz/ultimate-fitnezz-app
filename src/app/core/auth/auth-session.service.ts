import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, isDevMode, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthSessionResponse {
  authenticated: true;
  email: string | null;
}

export const AUTH_SESSION_REQUIRED = new InjectionToken<boolean>('AUTH_SESSION_REQUIRED', {
  providedIn: 'root',
  factory: () => !isDevMode(),
});

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly sessionRequired = inject(AUTH_SESSION_REQUIRED);
  private readonly lastCheckMaxAgeMs = 60_000;
  private pendingCheck?: Promise<boolean>;
  private lastSuccessfulCheck = 0;

  readonly status = signal<AuthStatus>(this.sessionRequired ? 'checking' : 'authenticated');
  readonly email = signal<string | null>(null);

  async initialize(): Promise<void> {
    const authenticated = await this.verifySession(true);
    if (!authenticated) {
      this.redirectToSignIn();
    }
  }

  verifySession(force = false): Promise<boolean> {
    if (!this.sessionRequired) {
      this.status.set('authenticated');
      return Promise.resolve(true);
    }

    if (!force && this.lastSuccessfulCheck > Date.now() - this.lastCheckMaxAgeMs) {
      return Promise.resolve(true);
    }

    if (this.pendingCheck) {
      return this.pendingCheck;
    }

    this.status.set('checking');
    this.pendingCheck = firstValueFrom(
      this.http.get<AuthSessionResponse>('/api/auth/session', {
        params: { 'ngsw-bypass': 'auth-session' },
      }),
    )
      .then((session) => {
        if (session.authenticated !== true) {
          return this.markUnauthenticated();
        }
        this.email.set(session.email);
        this.status.set('authenticated');
        this.lastSuccessfulCheck = Date.now();
        this.removeMigrationBypass();
        return true;
      })
      .catch(() => this.markUnauthenticated())
      .finally(() => {
        this.pendingCheck = undefined;
      });

    return this.pendingCheck;
  }

  redirectToSignIn(force = false): void {
    this.markUnauthenticated();
    const browser = this.document.defaultView;
    if (!browser) return;

    const target = new URL(browser.location.href);
    const alreadyBypassing = target.searchParams.has('ngsw-bypass');
    if (alreadyBypassing && !force) return;

    target.searchParams.set('ngsw-bypass', 'secure-auth-v1');
    browser.location.replace(target.toString());
  }

  private markUnauthenticated(): false {
    this.email.set(null);
    this.status.set('unauthenticated');
    return false;
  }

  private removeMigrationBypass(): void {
    const browser = this.document.defaultView;
    if (!browser) return;

    const current = new URL(browser.location.href);
    if (current.searchParams.get('ngsw-bypass') !== 'secure-auth-v1') return;

    current.searchParams.delete('ngsw-bypass');
    browser.history.replaceState(browser.history.state, '', current.toString());
  }
}
