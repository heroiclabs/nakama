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

import {Component, Injectable, OnInit} from '@angular/core';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {
  ApiPurchaseList,
  ConsoleService,
  ApiStoreProvider,
  ApiValidatedSubscription, ApiSubscriptionList
} from '../../console.service';
import {Observable} from 'rxjs';

@Component({
  selector: 'app-subscriptions',
  templateUrl: './subscriptions.component.html',
  styleUrls: ['./subscriptions.component.scss'],
})
export class SubscriptionsComponent implements OnInit {
  public subscriptions: ApiValidatedSubscription[] = [];
  public error = '';
  public nextCursor = '';
  public prevCursor = '';
  public userID: string;
  public readonly limit = 100;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
  ) {}

  ngOnInit(): void {
    this.userID = this.route.parent.snapshot.paramMap.get('id');
    this.route.data.subscribe(data => {
      this.subscriptions = data[0].validated_subscriptions;
      this.nextCursor = data[0].cursor;
      this.prevCursor = data[0].prev_cursor;
    });
  }

  loadData(cursor: string): void {
    this.consoleService.listSubscriptions(
      '',
      this.userID,
      this.limit,
      cursor,
    ).subscribe(res => {
      this.subscriptions = res.validated_subscriptions;
      this.nextCursor = res.cursor;
      this.prevCursor = res.prev_cursor;
    }, error => {
      this.error = error;
    });
  }

  getStoreText(store: ApiStoreProvider): string {
    return this.formatStoreText(ApiStoreProvider[store]);
  }

  formatStoreText(label: string): string {
    return label.split('_').map(s => s[0] + s.slice(1).toLowerCase()).join(' ');
  }
}

@Injectable({providedIn: 'root'})
export class SubscriptionsResolver implements Resolve<ApiPurchaseList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiSubscriptionList> {
    const userId = route.parent.paramMap.get('id');
    return this.consoleService.listSubscriptions('', userId, 100, '');
  }
}
