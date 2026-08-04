import { inject } from '@angular/core';
import { CanActivateChildFn } from '@angular/router';
import { AuthSessionService } from './auth-session.service';

export const authenticatedGuard: CanActivateChildFn = async () => {
  const auth = inject(AuthSessionService);
  const authenticated = await auth.verifySession();
  if (!authenticated) {
    auth.redirectToSignIn();
  }
  return authenticated;
};
