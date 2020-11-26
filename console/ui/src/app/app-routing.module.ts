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

import {NgModule} from '@angular/core';
import {Routes, RouterModule} from '@angular/router';
import {LoginComponent, LoginGuard} from './login/login.component';
import {AuthenticationGuard} from './authentication.guard';
import {BaseComponent, PageviewGuard} from './base/base.component';
import {GraphInitNodesResolver, StatusComponent} from './status/status.component';
import {ConfigComponent, ConfigResolver} from './config/config.component';
import {UsersComponent, UsersResolver} from './users/users.component';
import {RuntimeComponent, RuntimeResolver} from './runtime/runtime.component';
import {StorageCollectionResolver, StorageListComponent, StorageSearchResolver} from './storage/storage.component';
import {StorageObjectComponent, StorageObjectResolver} from './storage-object/storage-object.component';
import {LeaderboardsComponent, LeaderboardListResolver} from './leaderboards/leaderboards.component';

const routes: Routes = [
  {
    path: '',
    component: BaseComponent,
    canActivate: [AuthenticationGuard],
    canActivateChild: [PageviewGuard],
    children: [
      { path: '', redirectTo: 'status', pathMatch: 'full' },
      { path: 'status', component: StatusComponent, resolve: [GraphInitNodesResolver]},
      { path: 'config', component: ConfigComponent, resolve: [ConfigResolver]},
      { path: 'users', component: UsersComponent, resolve: [UsersResolver]},
      { path: 'modules', component: RuntimeComponent, resolve: [RuntimeResolver]},
      { path: 'storage', component: StorageListComponent, resolve: [StorageCollectionResolver, StorageSearchResolver], pathMatch: 'full'},
      { path: 'storage/:collection/:key/:user_id', component: StorageObjectComponent, resolve: [StorageObjectResolver], pathMatch: 'full'},
      { path: 'leaderboards', component: LeaderboardsComponent, resolve: [LeaderboardListResolver]},
      { path: 'leaderboard/:id', component: LeaderboardsComponent, resolve: []},
      // { path: 'accounts', component: AccountsComponent, resolve: []},
      // { path: 'matches', component: MatchesComponent, resolve: []},
      // { path: 'apiexplorer', component: ExplorerComponent, resolve: []},
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
