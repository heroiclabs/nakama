// Copyright 2020 Heroic Labs.
// All rights reserved.
//
// NOTICE: All information contained herein is, and remains the property of Heroic
// Labs. and its suppliers, if any. The intellectual and technical concepts
// contained herein are proprietary to Heroic Labs. and its suppliers and may be
// covered by U.S. and Foreign Patents, patents in process, and are protected by
// trade secret or copyright law. Dissemination of this information or reproduction
// of this material is strictly forbidden unless prior written permission is
// obtained from Heroic Labs.

import {HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpResponse} from '@angular/common/http';
import {AuthenticationService} from './authentication.service';
import {LoadingService} from './loading.service';
import {Observable} from 'rxjs';
import {tap} from 'rxjs/operators';
import {Injectable} from '@angular/core';

@Injectable()
export class SessionInterceptor implements HttpInterceptor {
  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly loadingService: LoadingService
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const session = this.authenticationService.currentSessionValue;
    if (session && session.token) {
      req = req.clone({
        setHeaders: {
          Authorization: `Bearer ${session.token}`
        }
      });
    }

    return next.handle(req).pipe(tap(
      (event: HttpEvent<any>) => {
        if (event instanceof HttpResponse) {
          this.loadingService.hide();
          return;
        }
        this.loadingService.show();
      },
      (err: any) => {
        this.loadingService.hide();
      }));
  }
}
