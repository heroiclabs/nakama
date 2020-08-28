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
import {HttpClient} from '@angular/common/http';
import {BehaviorSubject, Observable, pipe} from 'rxjs';
import {map, tap} from 'rxjs/operators';
import {ConsoleService, ConsoleSession} from './console.service';
import {WINDOW} from './window.provider';
import {SegmentService} from 'ngx-segment-analytics';

const SESSION_LOCALSTORAGE_KEY = 'currentSession';

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
    private readonly consoleService: ConsoleService
  ) {
    const restoredSession: ConsoleSession = JSON.parse(<string> localStorage.getItem(SESSION_LOCALSTORAGE_KEY));
    // TODO add user ID to session
    // if (restoredSession) {
    //   this.segment.identify(restoredSession.user_id);
    // }
    this.currentSessionSubject = new BehaviorSubject<ConsoleSession>(restoredSession);
    this.currentSession = this.currentSessionSubject.asObservable();
  }

  public get currentSessionValue(): ConsoleSession {
    return this.currentSessionSubject.getValue();
  }

  login(username: string, password: string): Observable<ConsoleSession> {
    return this.consoleService.authenticate({username, password}).pipe(tap(session => {
      localStorage.setItem(SESSION_LOCALSTORAGE_KEY, JSON.stringify(session));
      this.currentSessionSubject.next(session);
      // TODO add user ID to session
      // this.segment.identify(session.user_id, {username});
    }));
  }

  logout() {
    localStorage.removeItem(SESSION_LOCALSTORAGE_KEY);
    // @ts-ignore
    this.currentSessionSubject.next(null);
  }
}
