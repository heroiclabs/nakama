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

import {HttpEvent, HttpHandler, HttpInterceptor, HttpRequest} from '@angular/common/http';
import {AuthenticationService} from './authentication.service';
import {Observable, throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {Injectable} from '@angular/core';
import {Router} from '@angular/router';
import {OrganizationService} from './organization.service';
import {AccountService} from './account.service';
import {ProjectService} from './project.service';

@Injectable()
export class AuthenticationErrorInterceptor implements HttpInterceptor {
  constructor(
    private readonly authenticationService: AuthenticationService,
    //private readonly accountService: AccountService,
    //private readonly orgService: OrganizationService,
    //private readonly projectService: ProjectService,
    private readonly router: Router
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(catchError(err => {
      if (err.status === 401 || err.status === 404) {
        this.authenticationService.logout();
        //this.accountService.reset();
        //this.orgService.reset();
        //this.projectService.reset();

        if (!req.url.includes('/v2/console/authenticate')) {
          // only reload the page if we aren't on the auth pages, this is so that we can display the auth errors.
          const stateUrl = this.router.routerState.snapshot.url;
          const _ = this.router.navigate(['/login'], {queryParams: {next: stateUrl}});
        }
      } else if (err.status >= 500) {
        console.log(`${err.status}: + ${err.error.message || err.statusText}`);
      }
      const error = err.error.message || err.statusText;
      return throwError(error);
    }));
  }
}
