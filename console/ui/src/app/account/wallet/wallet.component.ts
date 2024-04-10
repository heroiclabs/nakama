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
  WalletLedgerList,
} from '../../console.service';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {AuthenticationService} from '../../authentication.service';
import {JSONEditor, Mode, toTextContent} from 'vanilla-jsoneditor';
import {Observable} from 'rxjs';
import {DeleteConfirmService} from '../../shared/delete-confirm.service';

@Component({
  templateUrl: './wallet.component.html',
  styleUrls: ['./wallet.component.scss']
})
export class WalletComponent implements OnInit, AfterViewInit {
  @ViewChild('editor') private editor: ElementRef<HTMLElement>;

  private jsonEditor: JSONEditor;
  public error = '';
  public account: ApiAccount;
  public walletLedger: Array<WalletLedger> = [];
  public walletLedgerMetadataOpen: Array<boolean> = [];
  public updating = false;
  public updated = false;
  public nextCursor = '';
  public prevCursor = '';
  public readonly limit = 100;
  public userID: string;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {}

  ngOnInit(): void {
    this.userID = this.route.parent.snapshot.paramMap.get('id');
    this.route.data.subscribe(
      d => {
        this.walletLedger.length = 0;
        this.walletLedger.push(...d[0].items);
        this.walletLedgerMetadataOpen.length = this.walletLedger.length;
        this.nextCursor = d[0].next_cursor;
        this.prevCursor = d[0].prev_cursor;
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

  loadData(cursor: string): void {
    this.consoleService.getWalletLedger(
      '',
      this.userID,
      this.limit,
      cursor,
    ).subscribe(res => {
      this.walletLedger = res.items;
      this.walletLedgerMetadataOpen = [];
      this.nextCursor = res.next_cursor;
      this.prevCursor = res.prev_cursor;
    }, error => {
      this.error = error;
    });
  }

  ngAfterViewInit(): void {
    this.jsonEditor = new JSONEditor({
      target: this.editor.nativeElement,
      props: {
        mode: Mode.text,
        readOnly: !this.updateAllowed(),
        content:{text:this.account.wallet},
      },
    });
  }

  updateWallet(): void {
    this.error = '';
    this.updated = false;
    this.updating = true;

    let wallet = '';
    try {
      wallet = toTextContent(this.jsonEditor.get()).text;
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
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
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
    );
  }
}

@Injectable({providedIn: 'root'})
export class WalletLedgerResolver implements Resolve<WalletLedgerList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<WalletLedgerList> {
    const userId = route.parent.paramMap.get('id');
    return this.consoleService.getWalletLedger('', userId, 100, '');
  }
}
