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
import {ApiStorageObject, ConsoleService, StorageCollectionsList, StorageList, UserRole} from '../console.service';
import {Observable} from 'rxjs';
import {UntypedFormBuilder, UntypedFormGroup} from '@angular/forms';
import {AuthenticationService} from '../authentication.service';
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './storage.component.html',
  styleUrls: ['./storage.component.scss']
})
export class StorageListComponent implements OnInit {
  public readonly systemUserId = '00000000-0000-0000-0000-000000000000';
  public error = '';
  public collections = [];
  public objects: Array<ApiStorageObject> = [];
  public objectCount = 0;
  public nextCursor = '';
  public prevCursor = '';
  public searchForm: UntypedFormGroup;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly consoleService: ConsoleService,
    private readonly authService: AuthenticationService,
    private readonly formBuilder: UntypedFormBuilder,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {}

  ngOnInit(): void {
    this.searchForm = this.formBuilder.group({
      collection: [''],
      key: [''],
      user_id: [''],
    });

    const qp = this.route.snapshot.queryParamMap;
    this.f.collection.setValue(qp.get('collection'));
    this.f.key.setValue(qp.get('key'));
    this.f.user_id.setValue(qp.get('user_id'));

    this.nextCursor = qp.get('cursor');

    if (this.nextCursor && this.nextCursor !== '') {
      this.search(1);
    } else if (this.f.collection.value || this.f.user_id.value) {
      this.search(0);
    }

    this.route.data.subscribe(
      d => {
        this.collections.length = 0;
        this.collections.push(...d[0].collections);

        this.objectCount = d[1].total_count;
        this.nextCursor = d[1].next_cursor;
        this.prevCursor = d[1].prev_cursor;
        this.objects.length = 0;
        this.objects.push(...d[1].objects);
      },
      err => {
        this.error = err;
      });
  }

  disableSearch(): boolean {
    // if key is not set, don't disable search.
    // if key is set, make sure collection is also set, otherwise disable search.
    if (this.f.key.value && this.f.key.value !== '') {
      return !(this.f.collection.value && this.f.collection.value !== '');
    }

    return false;
  }

  search(state: number): void {
    let cursor = '';
    switch (state) {
      case -1:
        cursor = this.prevCursor;
        break;
      case 0:
        cursor = '';
        break;
      case 1:
        cursor = this.nextCursor;
        break;
    }

    this.consoleService.listStorage('', this.f.user_id.value, this.f.key.value, this.f.collection.value, cursor).subscribe(d => {
      this.error = '';
      this.objectCount = d.total_count;
      this.nextCursor = d.next_cursor;
      this.objects.length = 0;
      this.objects.push(...d.objects);

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          collection: this.f.collection.value,
          key: this.f.key.value,
          user_id: this.f.user_id.value,
          cursor,
        },
        queryParamsHandling: 'merge',
      });
    }, err => {
      this.error = err;
    });

  }

  deleteObject(event, i: number, o: ApiStorageObject): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        event.target.disabled = true;
        event.preventDefault();
        this.error = '';
        this.consoleService.deleteStorageObject('', o.collection, o.key, o.user_id, o.version).subscribe(() => {
          this.error = '';
          this.objectCount--;
          this.objects.splice(i, 1);
        }, err => {
          this.error = err;
        });
      }
    );
  }

  deleteAllowed(): boolean {
    // only admin and developers are allowed.
    return this.authService.sessionRole <= UserRole.USER_ROLE_MAINTAINER;
  }

  viewObject(o: ApiStorageObject): void {
    this.router.navigate(['/storage', o.collection, o.key, o.user_id], {relativeTo: this.route});
  }

  get f(): any {
    return this.searchForm.controls;
  }
}

@Injectable({providedIn: 'root'})
export class StorageCollectionResolver implements Resolve<StorageCollectionsList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<StorageCollectionsList> {
    return this.consoleService.listStorageCollections('');
  }
}

@Injectable({providedIn: 'root'})
export class StorageSearchResolver implements Resolve<StorageList> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<StorageList> {
    const collection = route.queryParamMap.get('collection');
    const key = route.queryParamMap.get('key');
    const userId = route.queryParamMap.get('user_id');

    return this.consoleService.listStorage('', userId, key, collection, null);
  }
}
