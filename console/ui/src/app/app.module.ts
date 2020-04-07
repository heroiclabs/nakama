import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import {HTTP_INTERCEPTORS, HttpClientModule} from '@angular/common/http';
import {NgxChartsModule} from '@swimlane/ngx-charts';

import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {SessionInterceptor} from './session.interceptor';
import {LoginComponent} from './login/login.component';
import {BaseComponent} from './base/base.component';
import {StatusComponent} from './status/status.component';
import {ConfigurationComponent} from './configuration/configuration.component';
import {UsersComponent} from './users/users.component';
import {AuthenticationErrorInterceptor} from './authentication-error.interceptor';
import {StorageComponent} from './storage/storage.component';
import {ErrorService} from './error.service';

@NgModule({
  declarations: [
    AppComponent,
    BaseComponent,
    LoginComponent,
    StatusComponent,
    UsersComponent,
    StorageComponent,
    ConfigurationComponent,
  ],
  imports: [
    AppRoutingModule,
    BrowserModule,
    HttpClientModule,
    NgbModule,
    ReactiveFormsModule,
    FormsModule,
    CommonModule,
    NgxChartsModule,
    NoopAnimationsModule,
  ],
  providers: [
    {provide: ErrorService, useClass: ErrorService},
    {provide: HTTP_INTERCEPTORS, useClass: SessionInterceptor, multi: true},
    {provide: HTTP_INTERCEPTORS, useClass: AuthenticationErrorInterceptor, multi: true},
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
