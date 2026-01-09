import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/dashboard']);
  return false;
};

export const emailVerifiedGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (state.url.startsWith('/verify-email') || state.url.startsWith('/pending-verification')) {
    return true;
  }

  return authService.checkEmailVerified().pipe(
    map(response => {
      if (response.verified) {
        return true;
      }
      router.navigate(['/pending-verification']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/pending-verification']);
      return of(false);
    })
  );
};

export const discordLinkedGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (state.url.startsWith('/link-discord') || state.url.startsWith('/discord-callback')) {
    return true;
  }

  return authService.checkDiscordLinked().pipe(
    map(response => {
      if (response.linked) {
        return true;
      }
      router.navigate(['/link-discord']);
      return false;
    }),
    catchError(() => {
      router.navigate(['/link-discord']);
      return of(false);
    })
  );
};
