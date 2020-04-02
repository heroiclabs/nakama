// Copyright 2019 Heroic Labs.
// All rights reserved.
//
// NOTICE: All information contained herein is, and remains the property of Heroic
// Labs. and its suppliers, if any. The intellectual and technical concepts
// contained herein are proprietary to Heroic Labs. and its suppliers and may be
// covered by U.S. and Foreign Patents, patents in process, and are protected by
// trade secret or copyright law. Dissemination of this information or reproduction
// of this material is strictly forbidden unless prior written permission is
// obtained from Heroic Labs.

import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {BehaviorSubject, Observable, pipe} from 'rxjs';
import {map, tap} from 'rxjs/operators';
import {DeveloperConsole, ConsoleSession} from './console';

const SESSION_LOCALSTORAGE_KEY = 'currentSession';

@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  private readonly currentSessionSubject: BehaviorSubject<ConsoleSession>;
  readonly currentSession: Observable<ConsoleSession>;

  constructor(
    private readonly http: HttpClient,
    private readonly console: DeveloperConsole,
  ) {
    const restoredUser = JSON.parse(localStorage.getItem(SESSION_LOCALSTORAGE_KEY));
    this.currentSessionSubject = new BehaviorSubject<ConsoleSession>(restoredUser);
    this.currentSession = this.currentSessionSubject.asObservable();
  }

  public get currentSessionValue(): ConsoleSession {
    return this.currentSessionSubject.getValue();
  }

  login(username: string, password: string): Observable<ConsoleSession> {
    return this.console.authenticate({username, password}).pipe(tap(session => {
    //if (session.active_time && Date.parse(session.active_time) > 0) {
    if (session.token) {
        localStorage.setItem(SESSION_LOCALSTORAGE_KEY, JSON.stringify(session));
        this.currentSessionSubject.next(session);
      } else {
        localStorage.removeItem(SESSION_LOCALSTORAGE_KEY);
      }
    }));
  }

  logout() {
    localStorage.removeItem(SESSION_LOCALSTORAGE_KEY);
    this.currentSessionSubject.next(null);
  }
}
