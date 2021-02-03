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

import {AfterViewInit, Component, ElementRef, Injectable, OnInit, ViewChild} from '@angular/core';
import {
  ApiAccount,
  ConsoleService,
  UpdateAccountRequest,
  UserRole,
  WalletLedger,
  WalletLedgerList
} from '../../console.service';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {AuthenticationService} from '../../authentication.service';
import * as ace from 'ace-builds';
import {Observable} from 'rxjs';

@Component({
  templateUrl: './wallet.component.html',
  styleUrls: ['./wallet.component.scss']
})
export class WalletComponent implements OnInit, AfterViewInit {
  @ViewChild('editor') private editor: ElementRef<HTMLElement>;

  private aceEditor: ace.Ace.Editor;
  public error = '';
  public account: ApiAccount;
  public walletLedger: Array<WalletLedger> = [];
  public walletLedgerMetadataOpen: Array<boolean> = [];
  public updating = false;
  public updated = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe(
      d => {
        this.walletLedger.length = 0;
        this.walletLedger.push(...d[0].items);
        this.walletLedgerMetadataOpen.length = this.walletLedger.length;
      },
      err => {
        this.error = err;
      });

    this.route.parent.data.subscribe(
      d => {
        this.account = d[0].account;
      },
      err => {
        this.error = err;
      });
  }

  ngAfterViewInit(): void {
    ace.config.set('fontSize', '14px');
    ace.config.set('printMarginColumn', 0);
    ace.config.set('useWorker', true);
    ace.config.set('highlightSelectedWord', true);
    ace.config.set('fontFamily', '"Courier New", Courier, monospace');
    this.aceEditor = ace.edit(this.editor.nativeElement);
    this.aceEditor.setReadOnly(!this.updateAllowed());

    const value = JSON.stringify(JSON.parse(this.account.wallet), null, 2);
    this.aceEditor.session.setValue(value);
  }

  updateWallet(): void {
    this.error = '';
    this.updated = false;
    this.updating = true;

    let wallet = '';
    try {
      wallet = JSON.stringify(JSON.parse(this.aceEditor.session.getValue()));
    } catch (e) {
      this.error = e;
      this.updating = false;
      return;
    }

    const body: UpdateAccountRequest = {wallet};
    this.consoleService.updateAccount('', this.account.user.id, body).subscribe(d => {
      this.updated = true;
      this.updating = false;
    }, err => {
      this.error = err;
      this.updating = false;
    });
  }

  updateAllowed(): boolean {
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  deleteAllowed(): boolean {
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  deleteLedgerItem(event, i: number, w: WalletLedger): void {
    event.target.disabled = true;
    event.preventDefault();
    this.error = '';
    this.consoleService.deleteWalletLedger('', this.account.user.id, w.id).subscribe(() => {
      this.error = '';
      this.walletLedger.splice(i, 1);
      this.walletLedgerMetadataOpen.splice(i, 1);
    }, err => {
      this.error = err;
    });
  }
}

@Injectable({providedIn: 'root'})
export class WalletLedgerResolver implements Resolve<WalletLedgerList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<WalletLedgerList> {
    const userId = route.parent.paramMap.get('id');
    return this.consoleService.getWalletLedger('', userId);
  }
}
