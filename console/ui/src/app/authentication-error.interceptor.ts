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

import {HttpEvent, HttpHandler, HttpInterceptor, HttpRequest} from '@angular/common/http';
import {AuthenticationService} from './authentication.service';
import {Observable, throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {Injectable} from '@angular/core';
import {Router} from '@angular/router';

@Injectable()
export class AuthenticationErrorInterceptor implements HttpInterceptor {
  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly router: Router
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(catchError(err => {
      if (err.status === 401) {
        this.authenticationService.logout().subscribe({
          next: () => {
            if (!req.url.includes('/v3/auth')) {
              // only reload the page if we aren't on the auth pages, this is so that we can display the auth errors.
              const stateUrl = this.router.routerState.snapshot.url;
              const _ = this.router.navigate(['/login'], {queryParams: {next: stateUrl}});
            }
          }
        });
      } else if (err.status >= 500) {
        console.log(`${err.status}: + ${err.error.message || err.statusText}`);
      }
      const error = err.error.message || err.statusText;
      return throwError(error);
    }));
  }
}
