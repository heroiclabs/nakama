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
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, Router, RouterStateSnapshot} from '@angular/router';
import {JSONEditor, Mode, toTextContent} from 'vanilla-jsoneditor';
import {ApiStorageObject, ConsoleService, UserRole, WriteStorageObjectRequest} from '../console.service';
import {Observable} from 'rxjs';
import {UntypedFormBuilder, UntypedFormGroup, Validators} from '@angular/forms';
import {AuthenticationService} from '../authentication.service';
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './storage-object.component.html',
  styleUrls: ['./storage-object.component.scss']
})
export class StorageObjectComponent implements OnInit, AfterViewInit {
  @ViewChild('editor') private editor: ElementRef<HTMLElement>;

  private jsonEditor: JSONEditor;
  public error = '';
  public object: ApiStorageObject;
  public objectForm: UntypedFormGroup;
  public updating = false;
  public updated = false;

  ngOnInit(): void {
    this.objectForm = this.formBuilder.group({
      collection: ['', Validators.required],
      keyname: ['', Validators.required],
      user_id: ['', Validators.required],
      permission_read: [{value: 0, disabled: false}, Validators.required],
      permission_write: [{value: 0, disabled: false}, Validators.required]
    });

    this.route.data.subscribe(
      d => {
        this.object = d[0];
        this.f.collection.setValue(this.object.collection);
        this.f.keyname.setValue(this.object.key);
        this.f.user_id.setValue(this.object.user_id);
        this.f.permission_read.setValue(this.object.permission_read);
        this.f.permission_write.setValue(this.object.permission_write);
        if (!this.updateAllowed()) {
          this.objectForm.disable();
        }

      },
      err => {
        this.error = err;
      });
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly formBuilder: UntypedFormBuilder,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {}

  ngAfterViewInit(): void {
    this.jsonEditor = new JSONEditor({
      target: this.editor.nativeElement,
      props: {
        mode: Mode.text,
        readOnly: !this.updateAllowed(),
        content: {text: this.object.value},
      },
    });
  }

  updateObject(): void {
    this.error = '';
    this.updated = false;
    this.updating = true;

    let value = '';
    try {
      value = toTextContent(this.jsonEditor.get()).text;
    } catch (e) {
      this.error = e;
      this.updating = false;
      return;
    }

    let version = this.object.version;

    if (this.object.collection !== this.f.collection.value
      || this.object.key !== this.f.keyname.value
      || this.object.user_id !== this.f.user_id.value) {
      // don't send version through if we are changing collection/key/userid from the original object.
      version = '';
    }

    const body: WriteStorageObjectRequest = {
      version,
      value,
      permission_read: this.f.permission_read.value,
      permission_write: this.f.permission_write.value,
    };
    this.consoleService.writeStorageObject('', this.f.collection.value, this.f.keyname.value, this.f.user_id.value, body).subscribe(d => {
      this.updated = true;
      this.updating = false;
      this.object.version = d.version;

      if (version === '') {
        // if created copy, then reset the object definitions
        this.object.collection = this.f.collection.value;
        this.object.key = this.f.keyname.value;
        this.object.user_id = this.f.user_id.value;
        this.object.permission_read = this.f.permission_read.value;
        this.object.permission_write = this.f.permission_write.value;
      }

    }, err => {
      this.error = err;
      this.updating = false;
    });
  }

  deleteObject(): void {
    this.error = '';
    this.updated = false;
    this.updating = false;

    const o = this.object;
    this.consoleService.deleteStorageObject('', o.collection, o.key, o.user_id, o.version).subscribe(() => {
      this.router.navigate(['/storage'], {
        relativeTo: this.route,
        queryParams: {
          collection: this.f.collection.value,
          key: this.f.key.value,
          user_id: this.f.user_id.value,
        },
      });
    }, err => {
      this.error = err;
    });
  }

  updateAllowed(): any {
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  deleteAllowed(): any {
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  get f(): any {
    // console.log(this.objectForm.controls);
    return this.objectForm.controls;
  }
}

@Injectable({providedIn: 'root'})
export class StorageObjectResolver implements Resolve<ApiStorageObject> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<ApiStorageObject> {
    const collection = route.paramMap.get('collection');
    const key = route.paramMap.get('key');
    const userId = route.paramMap.get('user_id');

    return this.consoleService.getStorage('', collection, key, userId);
  }
}
