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
import {Component, OnDestroy, OnInit} from '@angular/core';
import {
  Router, ActivatedRoute, NavigationCancel, NavigationEnd, NavigationError, NavigationStart,
} from '@angular/router';
import {distinctUntilChanged} from 'rxjs/operators';
import {pipe, Subscription} from 'rxjs';
import {AuthenticationService} from '../authentication.service';
import {NgbNavChangeEvent} from '@ng-bootstrap/ng-bootstrap';
import {SegmentService} from 'ngx-segment-analytics';
import {ConsoleService} from '../console.service';

@Component({
  templateUrl: './base.component.html',
  styleUrls: ['./base.component.scss'],
})
export class BaseComponent implements OnInit, OnDestroy {
  private routerSub: Subscription;
  private segmentRouterSub: Subscription;
  public loading = true;
  public error = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private segment: SegmentService,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
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

    this.segmentRouterSub = router.events.pipe(distinctUntilChanged((previous: any, current: any) => {
      if (current instanceof NavigationEnd) {
        return previous.url === current.url;
      }
      return true;
    })).subscribe((nav: NavigationEnd) => {
      if (nav) {
        segment.page(nav.url);
      }
    });
  }

  ngOnInit(): void {
    this.route.data.subscribe(data => {
      this.error = data.error ? data.error : '';
    });
  }

  logout(): void {
    this.authService.logout();
  }

  ngOnDestroy(): void {
    this.segmentRouterSub.unsubscribe();
    this.routerSub.unsubscribe();
  }

  onSidebarNavChange(changeEvent: NgbNavChangeEvent): void {}
}
