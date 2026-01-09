import { Routes } from '@angular/router';
import { authGuard, guestGuard, emailVerifiedGuard, discordLinkedGuard } from './services/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent),
    canActivate: [guestGuard]
  },
  {
    path: 'register',
    loadComponent: () => import('./components/register/register.component').then(m => m.RegisterComponent),
    canActivate: [guestGuard]
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./components/verify-email/verify-email.component').then(m => m.VerifyEmailComponent)
  },
  {
    path: 'pending-verification',
    loadComponent: () => import('./components/pending-verification/pending-verification.component').then(m => m.PendingVerificationComponent),
    canActivate: [authGuard]
  },
  {
    path: 'link-discord',
    loadComponent: () => import('./components/link-discord/link-discord.component').then(m => m.LinkDiscordComponent),
    canActivate: [authGuard, emailVerifiedGuard]
  },
  {
    path: 'discord-callback',
    loadComponent: () => import('./components/discord-callback/discord-callback.component').then(m => m.DiscordCallbackComponent),
    canActivate: [authGuard]
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./components/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard, emailVerifiedGuard, discordLinkedGuard]
  },
  {
    path: 'whitelist',
    loadComponent: () => import('./components/whitelist-application/whitelist-application.component').then(m => m.WhitelistApplicationComponent),
    canActivate: [authGuard, emailVerifiedGuard, discordLinkedGuard]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
