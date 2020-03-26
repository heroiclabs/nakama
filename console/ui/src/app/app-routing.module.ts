import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import {AuthenticationGuard} from './authentication.guard';
import {BaseComponent, BaseGuard} from './base/base.component';
import {LoginComponent, LoginRegisterGuard} from './login/login.component';
import {StatusComponent} from './status/status.component';

const routes: Routes = [
  {
    path: '',
    component: BaseComponent,
    canActivate: [AuthenticationGuard],
    children: [
      { path: '', component: StatusComponent },
    ],
  },

  {path: 'login', component: LoginComponent, canActivate: [LoginRegisterGuard]},

  // Fallback redirect.
  {path: '**', redirectTo: ''}
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { enableTracing: true })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
