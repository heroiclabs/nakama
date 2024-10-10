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

import {Inject, Injectable} from '@angular/core';
import {HttpClient, HttpResponse} from '@angular/common/http';
import {BehaviorSubject, EMPTY, Observable, of, throwError} from 'rxjs';
import {tap} from 'rxjs/operators';
import {
  AuthenticateMFASetupRequest, AuthenticateMFASetupResponse,
  AuthenticateRequest,
  ConfigParams,
  ConsoleService,
  ConsoleSession,
  UserRole
} from './console.service';
import {WINDOW} from './window.provider';
import {SegmentService} from 'ngx-segment-analytics';
import {environment} from '../environments/environment';

const SESSION_LOCALSTORAGE_KEY = 'currentSession';

interface SessionClaims {
  id: string;
  usn: string;
  ema: string;
  rol: number;
  exp: number;
  cki: string;
}

export interface MFAClaims {
  user_id: string;
  user_email: string;
  exp: number;
  crt: number;
  secret: string;
  mfa_url: string;
  mfa_required: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  private readonly currentSessionSubject: BehaviorSubject<ConsoleSession>;
  readonly currentSession: Observable<ConsoleSession>;

  constructor(
    @Inject(WINDOW) private window: Window,
    private segment: SegmentService,
    private readonly http: HttpClient,
    private readonly consoleService: ConsoleService,
    private readonly config: ConfigParams,
  ) {
    const restoredSession: ConsoleSession = JSON.parse(localStorage.getItem(SESSION_LOCALSTORAGE_KEY) as string);
    if (restoredSession && !environment.nt) {
      this.segmentIdentify(restoredSession);
    }
    this.currentSessionSubject = new BehaviorSubject<ConsoleSession>(restoredSession);
    this.currentSession = this.currentSessionSubject.asObservable();
  }

  public get session(): ConsoleSession {
    return this.currentSessionSubject.getValue();
  }

  public get username(): string {
    const claims = this.claims;
    return claims.usn;
  }

  public get sessionRole(): UserRole {
    const claims = this.claims;
    const role = claims.rol as number;
    switch (role) {
      case 1:
        return UserRole.USER_ROLE_ADMIN;
      case 2:
        return UserRole.USER_ROLE_DEVELOPER;
      case 3:
        return UserRole.USER_ROLE_MAINTAINER;
      case 4:
        return UserRole.USER_ROLE_READONLY;
      default:
        return UserRole.USER_ROLE_UNKNOWN;
    }
  }

  public get claims(): SessionClaims {
    const token = this.currentSessionSubject.getValue().token;
    return this.decodeJWT(token);
  }

  public get mfa(): MFAClaims | null {
    const mfaToken = this.currentSessionSubject.getValue().mfa_code;
    if (!mfaToken) {
      return null;
    }
    return this.decodeJWT(mfaToken);
  }

  public get mfaRequired(): boolean {
    return this?.mfa?.mfa_required || false;
  }

  // Use custom login function implementation instead of ConsoleService to allow exposing the http response.
  login(username: string, password: string, code: string): Observable<HttpResponse<ConsoleSession>> {
    const req: AuthenticateRequest = {
      username,
      password,
      mfa: code,
    };
    // tslint:disable-next-line:max-line-length
    return this.http.post<ConsoleSession>(this.config.host + '/v2/console/authenticate', req, { observe: 'response' }).pipe(tap(response => {
      localStorage.setItem(SESSION_LOCALSTORAGE_KEY, JSON.stringify(response.body));
      this.currentSessionSubject.next(response.body);

      if (!environment.nt) {
        this.segmentIdentify(response.body);
      }
    }));
  }

  logout(): Observable<any> {
    if (!this.currentSessionSubject.getValue()) {
      return EMPTY;
    }
    return this.consoleService.authenticateLogout('', {
      token: this.currentSessionSubject.getValue()?.token,
    }).pipe(tap(() => {
      localStorage.removeItem(SESSION_LOCALSTORAGE_KEY);
      this.currentSessionSubject.next(null);
    }));
  }

  decodeJWT(token: string): any {
    const { 1: base64Raw } = token.split('.');
    const base64 = base64Raw.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map((c) => {
      return `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`;
    }).join(''));

    return JSON.parse(jsonPayload);
  }

  mfaSet(code: string): Observable<AuthenticateMFASetupResponse> {
    const payload: AuthenticateMFASetupRequest = {
      mfa: this.session.mfa_code,
      code,
    };
    return this.consoleService.authenticateMFASetup('', payload).pipe(tap(() => {
      // MFA is set so no need to require it anymore.
      this.session.mfa_code = null;
      localStorage.setItem(SESSION_LOCALSTORAGE_KEY, JSON.stringify(this.session));
      this.currentSessionSubject.next(this.session);
    }));
  }

  segmentIdentify(session): void {
    const token = session.token;
    const claims = this.decodeJWT(token);
    // null user ID to ensure we use Anonymous IDs
    const _ = this.segment.identify(null, {
      username: claims.usn,
      email: claims.ema,
      cookie: claims.cki,
    });
  }
}
