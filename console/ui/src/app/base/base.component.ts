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
import {ErrorService} from '../error.service';

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
    private readonly errorService: ErrorService,
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

  ngOnInit(): void {
    this.errorService.reportedError$.subscribe(
      error => {
        this.error = error
      }
    )
  }
  ngOnDestroy(): void {}
}
