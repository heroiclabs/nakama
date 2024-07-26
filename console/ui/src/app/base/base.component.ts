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

import {Component, Injectable, OnDestroy, OnInit} from '@angular/core';
import {
  Router,
  ActivatedRoute,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  CanActivate,
  CanActivateChild,
  ActivatedRouteSnapshot, RouterStateSnapshot,
} from '@angular/router';
import {bufferTime, distinctUntilChanged} from 'rxjs/operators';
import {Subscription} from 'rxjs';
import {AuthenticationService} from '../authentication.service';
import {NgbNavChangeEvent} from '@ng-bootstrap/ng-bootstrap';
import {SegmentService} from 'ngx-segment-analytics';
import {ConsoleService, UserRole} from '../console.service';
import {Globals} from '../globals';
import {environment} from "../../environments/environment";

@Component({
  templateUrl: './base.component.html',
  styleUrls: ['./base.component.scss'],
})
export class BaseComponent implements OnInit, OnDestroy {
  private routerSub: Subscription;
  private segmentRouterSub: Subscription;
  public loading = true;
  public error = '';

  public routes = [
    {navItem: 'status', routerLink: ['/status'], label: 'Status', minRole: UserRole.USER_ROLE_READONLY, icon: 'status'},
    {navItem: 'users', routerLink: ['/users'], label: 'User Management', minRole: UserRole.USER_ROLE_ADMIN, icon: 'user-management'},
    {navItem: 'config', routerLink: ['/config'], label: 'Configuration', minRole: UserRole.USER_ROLE_DEVELOPER, icon: 'configuration'},
    {navItem: 'modules', routerLink: ['/modules'], label: 'Runtime Modules', minRole: UserRole.USER_ROLE_DEVELOPER, separator: true, icon: 'runtime-modules'},
    {navItem: 'accounts', routerLink: ['/accounts'], label: 'Accounts', minRole: UserRole.USER_ROLE_READONLY, icon: 'accounts'},
    {navItem: 'groups', routerLink: ['/groups'], label: 'Groups', minRole: UserRole.USER_ROLE_READONLY, icon: 'groups'},
    {navItem: 'storage', routerLink: ['/storage'], label: 'Storage', minRole: UserRole.USER_ROLE_READONLY, icon: 'storage'},
    {navItem: 'leaderboards', routerLink: ['/leaderboards'], label: 'Leaderboards', minRole: UserRole.USER_ROLE_READONLY, icon: 'leaderboard'},
    {navItem: 'chat', routerLink: ['/chat'], label: 'Chat Messages', minRole: UserRole.USER_ROLE_READONLY, icon: 'chat'},
    {navItem: 'purchases', routerLink: ['/purchases'], label: 'Purchases', minRole: UserRole.USER_ROLE_READONLY, icon: ''},
    {navItem: 'subscriptions', routerLink: ['/subscriptions'], label: 'Subscriptions', minRole: UserRole.USER_ROLE_READONLY, icon: ''},
    {navItem: 'matches', routerLink: ['/matches'], label: 'Matches', minRole: UserRole.USER_ROLE_READONLY, icon: 'running-matches'},
    {navItem: 'apiexplorer', routerLink: ['/apiexplorer'], label: 'API Explorer', minRole: UserRole.USER_ROLE_DEVELOPER, icon: 'api-explorer'},
  ];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private segment: SegmentService,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
  ) {
    this.loading = false;
    // Buffer router events every 2 seconds, to reduce loading screen jitter
    this.routerSub = this.router.events.pipe(bufferTime(2000)).subscribe(events => {
      if (events.length === 0) {
        return;
      }

      const event = events[events.length - 1];
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
        this.error = event.error;
      }
    });

    this.segmentRouterSub = router.events.pipe(distinctUntilChanged((previous: any, current: any) => {
      if (current instanceof NavigationEnd) {
        return previous.url === current.url;
      }
      return true;
    })).subscribe((nav: NavigationEnd) => {
      if (nav && !environment.nt) {
        segment.page(nav.url);
      }
    });
  }

  ngOnInit(): void {
    this.route.data.subscribe(data => {
      this.error = data.error ? data.error : '';
    });
  }

  getSessionRole(): UserRole {
    return this.authService.sessionRole;
  }

  getUsername(): string {
    return this.authService.username;
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }

  ngOnDestroy(): void {
    this.segmentRouterSub.unsubscribe();
    this.routerSub.unsubscribe();
  }

  onSidebarNavChange(changeEvent: NgbNavChangeEvent): void {}
}

@Injectable({providedIn: 'root'})
export class PageviewGuard implements CanActivate, CanActivateChild {
  constructor(private readonly authService: AuthenticationService, private readonly router: Router, private readonly globals: Globals) {}

  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
    return true;
  }

  canActivateChild(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
    const role = this.globals.restrictedPages.get(next.url[0].path);
    if (role !== null && role < this.authService.sessionRole) {
      // if the page has restriction, and role doesn't match it, navigate to home
      const _ = this.router.navigate(['/']);
      return false;
    }

    return true;
  }
}
