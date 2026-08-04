import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AUTH_SESSION_REQUIRED, AuthSessionService } from './auth-session.service';

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AUTH_SESSION_REQUIRED, useValue: true },
      ],
    });
    service = TestBed.inject(AuthSessionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('authenticates only after a live session response', async () => {
    const result = service.verifySession(true);
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/auth/session' &&
        candidate.params.get('ngsw-bypass') === 'auth-session',
    );
    request.flush({ authenticated: true, email: 'trainer@example.com' });

    await expect(result).resolves.toBe(true);
    expect(service.status()).toBe('authenticated');
    expect(service.email()).toBe('trainer@example.com');
  });

  it('blocks access when the session request fails', async () => {
    const result = service.verifySession(true);
    const request = http.expectOne((candidate) => candidate.url === '/api/auth/session');
    request.flush('Sign in required', { status: 403, statusText: 'Forbidden' });

    await expect(result).resolves.toBe(false);
    expect(service.status()).toBe('unauthenticated');
    expect(service.email()).toBeNull();
  });
});
