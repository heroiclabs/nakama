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

import {Component, Injectable, OnDestroy, OnInit} from '@angular/core';
import {
  Router, RouterStateSnapshot, ActivatedRoute, ActivatedRouteSnapshot,
  CanActivate, NavigationCancel, NavigationEnd, NavigationError, NavigationStart,
} from '@angular/router';
import {catchError, map, timeout} from 'rxjs/operators';
import {forkJoin, Observable, of, pipe, Subscription} from 'rxjs';
import {Account} from '../console.service';
import {NgbNavChangeEvent} from '@ng-bootstrap/ng-bootstrap';
import {ErrorService} from '../error.service';
import {LoadingService} from '../loading.service';

@Component({
  templateUrl: './base.component.html',
  styleUrls: ['./base.component.scss'],
})
export class BaseComponent implements OnInit, OnDestroy {
  private routerSub: Subscription;
  public account: Account;
  public router_loading = false;
  public backend_loading = false;
  public error = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly errorService: ErrorService,
    private readonly loadingService: LoadingService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.routerSub = this.router.events.subscribe(
      event => {
        if (event instanceof NavigationStart) {
          this.router_loading = true;
          return;
        }

        this.router_loading = false;
      }
    );

    this.errorService.reportedError$.subscribe(
      error => {
        this.error = error
      }
    );
    this.loadingService.backendLoading$.subscribe(
      show => {
        this.backend_loading = show;
      }
    );
  }

  ngOnDestroy(): void {}
}
