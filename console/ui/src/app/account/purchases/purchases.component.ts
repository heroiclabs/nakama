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
import {ApiPurchaseList, ApiValidatedPurchase, ConsoleService, ApiStoreProvider} from '../../console.service';
import {Observable} from 'rxjs';

@Component({
  selector: 'app-purchases',
  templateUrl: './purchases.component.html',
  styleUrls: ['./purchases.component.scss'],
})
export class PurchasesComponent implements OnInit, OnChanges {
  public purchases: ApiValidatedPurchase[] = [];
  public purchasesRowsOpen: boolean[] = [];
  public error = '';
  public nextCursor = '';
  public prevCursor = '';
  public userId: string;
  public readonly limit = 100;

  @Input('transaction_id') transactionId: string;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly consoleService: ConsoleService,
  ) {}

  ngOnInit(): void {
    const paramUserId = this.route?.parent?.snapshot?.paramMap?.get('id') ?? '';
    if (paramUserId) {
      this.userId = paramUserId;
    }
    this.route.data.subscribe(data => {
      this.purchases = data[0].validated_purchases;
      this.nextCursor = data[0].cursor;
      this.prevCursor = data[0].prev_cursor;
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.transactionId.firstChange) {
      if (this.transactionId) {
        this.transactionId = this.transactionId.trim();
        this.consoleService.getPurchase('', this.transactionId).subscribe(res => {
          this.purchases = [res];
        }, error => {
          this.error = error;
        });
      } else if (this.transactionId === '') {
        this.loadData('');
      }
    }
  }

  loadData(cursor: string): void {
    this.error = '';
    this.consoleService.listPurchases(
      '',
      this.userId,
      this.limit,
      cursor,
    ).subscribe(res => {
      this.purchases = res.validated_purchases;
      this.purchasesRowsOpen = [];
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
export class PurchasesResolver implements Resolve<ApiPurchaseList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiPurchaseList> {
    const userId = route.parent?.paramMap?.get('id') ?? '';

    return this.consoleService.listPurchases('', userId, 100, '');
  }
}
