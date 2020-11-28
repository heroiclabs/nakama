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
import {Globals} from './globals';
import {StorageListComponent} from './storage/storage.component';
import {StorageObjectComponent, StorageObjectResolver} from './storage-object/storage-object.component';

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
  ],
  imports: [
    NgxFileDropModule,
    AppRoutingModule,
    BrowserModule,
    HttpClientModule,
    NgbModule,
    NgxChartsModule,
    SegmentModule.forRoot({ apiKey: environment.segment_write_key, debug: !environment.production, loadOnInitialization: true }),
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
