import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { map, catchError, of } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/login']);
  return false;
};

export const adminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated() && authService.isAdmin()) {
    return true;
  }

  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
  } else {
    router.navigate(['/unauthorized']);
  }

  return false;
};

// Guard that checks if Discord is linked (async)
export const discordLinkedGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  // Skip check for link-discord and discord-callback routes
  if (state.url.startsWith('/link-discord') || state.url.startsWith('/discord-callback')) {
    return true;
  }

  return authService.checkDiscordLinked().pipe(
    map(response => {
      if (response.linked) {
        return true;
      } else {
        router.navigate(['/link-discord']);
        return false;
      }
    }),
    catchError(() => {
      // If check fails, allow access (don't block on error)
      return of(true);
    })
  );
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/admin']);
  return false;
};
