import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import {AuthenticationGuard} from './authentication.guard';
import {BaseComponent} from './base/base.component';
import {LoginComponent} from './login/login.component';
import {StatusComponent} from './status/status.component';
import {ConfigurationComponent} from './configuration/configuration.component';
import {UsersComponent} from './users/users.component';
import {StorageComponent} from './storage/storage.component';

const routes: Routes = [
  {
    path: '',
    component: BaseComponent,
    canActivate: [AuthenticationGuard],
    children: [
      {
        path: '',
        component: StatusComponent,
        data: { animation: 'StatusPage' }
      },
      {
        path: 'configuration',
        component: ConfigurationComponent,
        data: { animation: 'ConfigurationPage' }
      },
      {
        path: 'users',
        component: UsersComponent,
        data: { animation: 'UsersPage' }
      },
      {
        path: 'storage',
        component: StorageComponent,
        data: { animation: 'StoragePage' }
      },
    ],
  },

  {path: 'login', component: LoginComponent},

  // Fallback redirect.
  {path: '**', redirectTo: ''}
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
