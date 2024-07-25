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

import {BrowserModule} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {NgModule} from '@angular/core';

import {AppRoutingModule} from './app-routing.module';
import {AppComponent} from './app.component';
import {HTTP_INTERCEPTORS, HttpClientModule} from '@angular/common/http';
import {WINDOW_PROVIDERS} from './window.provider';
import {environment} from '../environments/environment';
import {NgxChartsModule} from '@swimlane/ngx-charts';
import {NgbModule} from '@ng-bootstrap/ng-bootstrap';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {NgSelectModule} from '@ng-select/ng-select';
import {Globals} from './globals';
import {SegmentModule} from 'ngx-segment-analytics';
import {SessionInterceptor} from './session.interceptor';
import {AuthenticationErrorInterceptor} from './authentication-error.interceptor';
import {LoginComponent} from './login/login.component';
import {BaseComponent} from './base/base.component';
import {SortNumbersPipe, StatusComponent} from './status/status.component';
import {ConfigComponent} from './config/config.component';
import {ConfigParams} from './console.service';
import {UsersComponent} from './users/users.component';
import {NgxFileDropModule} from 'ngx-file-drop';
import {RuntimeComponent} from './runtime/runtime.component';
import {StorageListComponent} from './storage/storage.component';
import {StorageObjectComponent} from './storage-object/storage-object.component';
import {AccountListComponent} from './accounts/accounts.component';
import {AccountComponent} from './account/account.component';
import {GroupListComponent} from './groups/groups.component';
import {GroupComponent} from './group/group.component';
import {ProfileComponent} from './account/profile/profile.component';
import {GroupDetailsComponent} from './group/details/groupDetailsComponent';
import {AuthenticationComponent} from './account/authentication/authentication.component';
import {FriendsComponent} from './account/friends/friends.component';
import {WalletComponent} from './account/wallet/wallet.component';
import {GroupsComponent} from './account/groups/groups.component';
import {GroupMembersComponent} from './group/members/groupMembers.component';
import {ChatListComponent} from './channels/chat-list.component';
import {PurchasesListComponent} from './purchases/purchases-list.component';
import {MatchesComponent} from './matches/matches.component';
import {LeaderboardsComponent} from './leaderboards/leaderboards.component';
import {LeaderboardComponent} from './leaderboard/leaderboard.component';
import {LeaderboardDetailsComponent} from './leaderboard/details/details.component';
import {LeaderboardRecordsComponent} from './leaderboard/records/records.component';
import {ApiExplorerComponent} from './apiexplorer/apiexplorer.component';
import {PurchasesComponent} from './account/purchases/purchases.component';
import {SubscriptionsComponent} from './account/subscriptions/subscriptions.component';
import {DeleteConfirmDialogComponent} from './shared/delete-confirm-dialog/delete-confirm-dialog.component';
import {SubscriptionsListComponent} from './subscriptions/subscriptions-list.component';

@NgModule({
  declarations: [
    AppComponent,
    SortNumbersPipe,
    BaseComponent,
    LoginComponent,
    StatusComponent,
    ConfigComponent,
    UsersComponent,
    RuntimeComponent,
    StorageListComponent,
    StorageObjectComponent,
    AccountListComponent,
    AccountComponent,
    ProfileComponent,
    AuthenticationComponent,
    WalletComponent,
    FriendsComponent,
    GroupsComponent,
    GroupComponent,
    GroupDetailsComponent,
    GroupMembersComponent,
    MatchesComponent,
    LeaderboardsComponent,
    LeaderboardComponent,
    LeaderboardDetailsComponent,
    LeaderboardRecordsComponent,
    ApiExplorerComponent,
    PurchasesComponent,
    SubscriptionsComponent,
    GroupListComponent,
    ChatListComponent,
    DeleteConfirmDialogComponent,
    PurchasesListComponent,
    SubscriptionsListComponent
  ],
  imports: [
    NgxFileDropModule,
    AppRoutingModule,
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    NgbModule,
    NgxChartsModule,
    SegmentModule.forRoot({ apiKey: environment.segment_write_key, debug: !environment.production, loadOnInitialization: !environment.nt }),
    NoopAnimationsModule,
    ReactiveFormsModule,
    FormsModule,
    NgSelectModule,
  ],
  providers: [
    WINDOW_PROVIDERS,
    Globals,
    {provide: ConfigParams, useValue: {host: environment.production ? document.location.origin : environment.apiBaseUrl, timeout: 15000}},
    {provide: HTTP_INTERCEPTORS, useClass: SessionInterceptor, multi: true},
    {provide: HTTP_INTERCEPTORS, useClass: AuthenticationErrorInterceptor, multi: true}
  ],
  bootstrap: [AppComponent]
})
export class AppModule {

}
