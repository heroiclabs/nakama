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
  // Main layout with sidebar and header
  {
    path: '',
    loadComponent: () => import('./components/layout/main-layout.component').then(m => m.MainLayoutComponent),
    canActivate: [authGuard, emailVerifiedGuard, discordLinkedGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./components/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'whitelist',
        loadComponent: () => import('./components/whitelist/whitelist-application.component').then(m => m.WhitelistApplicationComponent)
      },
      {
        path: 'douanier',
        loadComponent: () => import('./components/douanier/douanier-dashboard.component').then(m => m.DouanierDashboardComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
