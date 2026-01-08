import { Routes } from '@angular/router';
import { authGuard, adminGuard, guestGuard } from './services/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent),
    canActivate: [guestGuard]
  },
  {
    path: 'admin',
    loadComponent: () => import('./components/admin/admin-layout.component').then(m => m.AdminLayoutComponent),
    canActivate: [authGuard, adminGuard],
    children: [
      {
        path: '',
        redirectTo: 'houses',
        pathMatch: 'full'
      },
      {
        path: 'houses',
        loadComponent: () => import('./components/houses/houses.component').then(m => m.HousesComponent)
      },
      {
        path: 'accounts',
        loadComponent: () => import('./components/accounts/accounts.component').then(m => m.AccountsComponent)
      },
      {
        path: 'characters',
        loadComponent: () => import('./components/characters/characters.component').then(m => m.CharactersComponent)
      },
      {
        path: 'characters/:id',
        loadComponent: () => import('./components/character-detail/character-detail.component').then(m => m.CharacterDetailComponent)
      },
      {
        path: 'logs',
        loadComponent: () => import('./components/logs/logs.component').then(m => m.LogsComponent)
      }
    ]
  },
  {
    path: 'unauthorized',
    loadComponent: () => import('./components/unauthorized/unauthorized.component').then(m => m.UnauthorizedComponent)
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
