// Copyright 2020 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import {LoginComponent, LoginGuard} from './login/login.component';
import {AuthenticationGuard} from './authentication.guard';
import {HomeComponent} from './home/home.component';
import {BaseComponent} from './base/base.component';
import {GraphInitNodesResolver, StatusComponent} from './status/status.component';

const routes: Routes = [
  {
    path: '',
    component: BaseComponent,
    canActivate: [AuthenticationGuard],
    children: [
      { path: '', redirectTo: 'status', pathMatch: 'full' },
      { path: '', component: StatusComponent, resolve: [GraphInitNodesResolver]},
    ]},
  {path: 'login', component: LoginComponent, canActivate: [LoginGuard]},

  // Fallback redirect.
  {path: '**', redirectTo: ''}
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes),
    // RouterModule.forRoot(routes, { enableTracing: true }), // TODO debugging purposes only
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
