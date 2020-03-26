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

import {Component, Injectable, OnDestroy, OnInit} from '@angular/core';
import {
  Router, RouterStateSnapshot, ActivatedRoute, ActivatedRouteSnapshot,
  CanActivate, NavigationCancel, NavigationEnd, NavigationError, NavigationStart,
} from '@angular/router';
import {catchError, map, timeout} from 'rxjs/operators';
import {forkJoin, Observable, of, pipe, Subscription} from 'rxjs';
import {Account} from '../console';
import {NgbNavChangeEvent} from '@ng-bootstrap/ng-bootstrap';

@Component({
  templateUrl: './base.component.html',
  styleUrls: ['./base.component.scss'],
})
export class BaseComponent implements OnInit, OnDestroy {
  private routerSub: Subscription;
  private orgSub: Subscription;
  private accountSub: Subscription;
  public account: Account;
  public loading = true;
  public error = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {
    this.loading = true;
    this.routerSub = this.router.events.subscribe(pipe(event => {
      if (event instanceof NavigationStart) {
        this.loading = true;
      }
      if (event instanceof NavigationEnd) {
        this.loading = false;
      }
      // Set loading state to false in both of the below events to hide the spinner in case a request fails
      if (event instanceof NavigationCancel) {
        this.loading = false;
      }
      if (event instanceof NavigationError) {
        this.loading = false;
      }
    }));
  }

  ngOnInit(): void {}
  ngOnDestroy(): void {}
}

@Injectable({providedIn: 'root'})
export class BaseGuard implements CanActivate {
  constructor(private readonly router: Router) {
  }
  // this is a workaround for https://github.com/angular/angular/issues/20805
  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> {
    /*
    if (this.accountService.currentAccountValue && this.orgService.organizations.length > 0) {
      return of(true);
    }

    return forkJoin([
      this.accountService.fetchAccount(),
      this.orgService.fetchOrganizations(),
    ]).pipe(map(d => true), catchError(error => {
      next.data = {...next.data, error};
      // return true irrespectively, so we can display the error;
      return of(true);
    }));
    */
    return of(true);
  }
}
