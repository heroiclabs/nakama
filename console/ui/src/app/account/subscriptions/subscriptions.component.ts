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

import {Component, Injectable, Input, OnChanges, OnInit, SimpleChanges} from '@angular/core';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {
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
export class SubscriptionsComponent implements OnInit, OnChanges {
  public subscriptions: ApiValidatedSubscription[] = [];
  public subscriptionsRowOpen: boolean[] = [];
  public error = '';
  public nextCursor = '';
  public prevCursor = '';
  public userId: string;
  public readonly limit = 100;

  @Input('original_transaction_id') originalTransactionId: string;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly consoleService: ConsoleService,
  ) {}

  ngOnInit(): void {
    const paramUserId = this.route?.parent?.snapshot?.paramMap?.get('id') ?? '';
    if (paramUserId) {
      this.userId = paramUserId;
    }
    this.userId = this.route.parent.snapshot.paramMap.get('id');
    this.route.data.subscribe(data => {
      this.subscriptions = data[0].validated_subscriptions;
      this.nextCursor = data[0].cursor;
      this.prevCursor = data[0].prev_cursor;
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.originalTransactionId.firstChange) {
      if (this.originalTransactionId) {
        this.originalTransactionId = this.originalTransactionId.trim();
        this.consoleService.getSubscription('', this.originalTransactionId).subscribe(res => {
          this.subscriptions = [res];
        }, error => {
          this.error = error;
        });
      } else if (this.originalTransactionId === '') {
        this.loadData('');
      }
    }
  }

  loadData(cursor: string): void {
    this.error = '';
    this.consoleService.listSubscriptions(
      '',
      this.userId,
      this.limit,
      cursor,
    ).subscribe(res => {
      this.subscriptions = res.validated_subscriptions;
      this.subscriptionsRowOpen = [];
      this.nextCursor = res.cursor;
      this.prevCursor = res.prev_cursor;
    }, error => {
      this.error = error;
    });
  }

  getStoreText(store: ApiStoreProvider): string {
    return this.formatStoreText(ApiStoreProvider[store]);
  }

  getRefundText(time: string): string {
    if (time === '1970-01-01T00:00:00Z') {
      return '';
    }
    return time;
  }

  formatStoreText(label: string): string {
    return label.split('_').map(s => s[0] + s.slice(1).toLowerCase()).join(' ');
  }
}

@Injectable({providedIn: 'root'})
export class SubscriptionsResolver implements Resolve<ApiSubscriptionList> {
  constructor(private readonly consoleService: ConsoleService) {
  }

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiSubscriptionList> {
    const userId = route.parent?.paramMap?.get('id') ?? '';

    return this.consoleService.listSubscriptions('', userId, 100, '');
  }
}
