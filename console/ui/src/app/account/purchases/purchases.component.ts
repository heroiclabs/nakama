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
import {ApiPurchaseList, ApiValidatedPurchase, ConsoleService, ValidatedPurchaseStore} from '../../console.service';
import {Observable} from 'rxjs';

@Component({
  selector: 'app-purchases',
  templateUrl: './purchases.component.html',
  styleUrls: ['./purchases.component.scss'],
})
export class PurchasesComponent implements OnInit {
  public purchases: ApiValidatedPurchase[] = [];
  public purchasesRowsOpen: boolean[] = [];
  public error = '';
  public nextCursor = '';
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
      this.purchases.push(...data[0].validated_purchases);
      this.nextCursor = data[0].cursor;
    });
  }

  loadOlderPurchases(): void {
    this.consoleService.listPurchases(
      '',
      this.userID,
      this.limit,
      this.nextCursor,
    ).subscribe(res => {
      this.purchases.push(...res.validated_purchases);
      this.purchasesRowsOpen.push(...Array(res.validated_purchases.length).fill(false));
      this.nextCursor = res.cursor;
    }, error => {
      this.error = error;
    });
  }

  getStoreText(store: ValidatedPurchaseStore): string {
    return this.formatStoreText(ValidatedPurchaseStore[store]);
  }

  formatStoreText(label: string): string {
    return label.split('_').map(s => s[0] + s.slice(1).toLowerCase()).join(' ');
  }
}

@Injectable({providedIn: 'root'})
export class PurchasesResolver implements Resolve<ApiPurchaseList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiPurchaseList> {
    const userId = route.parent.paramMap.get('id');
    return this.consoleService.listPurchases('', userId, 100, '');
  }
}
