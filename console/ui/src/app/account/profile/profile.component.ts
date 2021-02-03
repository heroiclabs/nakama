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

import {AfterViewInit, Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {ApiAccount, ConsoleService, UpdateAccountRequest, UserRole} from '../../console.service';
import {ActivatedRoute, Router} from '@angular/router';
import {AuthenticationService} from '../../authentication.service';
import {FormBuilder, FormGroup, Validators} from '@angular/forms';
import * as ace from 'ace-builds';

@Component({
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit, AfterViewInit {
  @ViewChild('editor') private editor: ElementRef<HTMLElement>;

  private aceEditor: ace.Ace.Editor;
  public error = '';
  public account: ApiAccount;
  public accountForm: FormGroup;
  public updating = false;
  public updated = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly formBuilder: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.accountForm = this.formBuilder.group({
      username: ['', Validators.required],
      display_name: [''],
      avatar_url: [''],
      location: [''],
      timezone: ['']
    });

    this.route.parent.data.subscribe(
      d => {
        this.account = d[0].account;
        this.f.username.setValue(this.account.user.username);
        this.f.display_name.setValue(this.account.user.display_name);
        this.f.avatar_url.setValue(this.account.user.avatar_url);
        this.f.location.setValue(this.account.user.location);
        this.f.timezone.setValue(this.account.user.timezone);
        if (!this.updateAllowed()) {
          this.accountForm.disable();
        }
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

    const value = JSON.stringify(JSON.parse(this.account.user.metadata), null, 2)
    this.aceEditor.session.setValue(value);
  }

  updateAccount(): void {
    this.error = '';
    this.updated = false;
    this.updating = true;

    let metadata = '';
    try {
      metadata = JSON.stringify(JSON.parse(this.aceEditor.session.getValue()));
    } catch (e) {
      this.error = e;
      this.updating = false;
      return
    }

    const body: UpdateAccountRequest = {
      username: this.f.username.value,
      display_name: this.f.display_name.value,
      avatar_url: this.f.avatar_url.value,
      location: this.f.location.value,
      timezone: this.f.timezone.value,
      metadata,
    };
    this.consoleService.updateAccount('', this.account.user.id, body).subscribe(d => {
      this.updated = true;
      this.updating = false;
    }, err => {
      this.error = err;
      this.updating = false;
    })
  }

  updateAllowed(): boolean {
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  get f(): any {
    return this.accountForm.controls;
  }
}
