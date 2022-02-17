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
import {
  ApiGroup,
  ConsoleService, UpdateGroupBody,
  UserRole
} from '../../console.service';
import {ActivatedRoute, Router} from '@angular/router';
import {AuthenticationService} from '../../authentication.service';
import {FormBuilder, FormGroup, Validators} from '@angular/forms';
import * as ace from 'ace-builds';

@Component({
  templateUrl: './groupDetails.component.html',
  styleUrls: ['./groupDetails.component.scss']
})
export class GroupDetailsComponent implements OnInit, AfterViewInit {
  @ViewChild('editor') private editor: ElementRef<HTMLElement>;

  private aceEditor: ace.Ace.Editor;
  public error = '';
  public group: ApiGroup;
  public groupForm: FormGroup;
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
    this.groupForm = this.formBuilder.group({
      name: ['', Validators.required],
      description: [''],
      avatar_url: [''],
      lang_tag: [''],
      open: [''],
      max_count: [''],
    });

    this.route.parent.data.subscribe(
      d => {
        this.group = d[0];
        this.f.name.setValue(this.group.name);
        this.f.description.setValue(this.group.description);
        this.f.avatar_url.setValue(this.group.avatar_url);
        this.f.lang_tag.setValue(this.group.lang_tag);
        this.f.open.setValue(this.group.open);
        this.f.max_count.setValue(this.group.max_count);
        if (!this.updateAllowed()) {
          this.groupForm.disable();
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

    const value = JSON.stringify(JSON.parse(this.group.metadata), null, 2)
    this.aceEditor.session.setValue(value);
  }

  updateGroup(): void {
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

    if (this.f.max_count.value < this.group.edge_count) {
      this.error = RangeError("Max Count cannot be lower than the number of members").message;
      this.updating = false;
      return
    }

    const body: UpdateGroupBody = {
      name: this.f.name.value,
      description: this.f.description.value,
      avatar_url: this.f.avatar_url.value,
      lang_tag: this.f.lang_tag.value,
      open: this.f.open.value,
      max_count: this.f.max_count.value,
      metadata: metadata,
    };
    this.consoleService.updateGroup('', this.group.id, body).subscribe(d => {
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
    return this.groupForm.controls;
  }
}
