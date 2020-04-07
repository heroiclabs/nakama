
// Copyright 2020 Heroic Labs.
// All rights reserved.
//
// NOTICE: All information contained herein is, and remains the property of Heroic
// Labs. and its suppliers, if any. The intellectual and technical concepts
// contained herein are proprietary to Heroic Labs. and its suppliers and may be
// covered by U.S. and Foreign Patents, patents in process, and are protected by
// trade secret or copyright law. Dissemination of this information or reproduction
// of this material is strictly forbidden unless prior written permission is
// obtained from Heroic Labs.

import {Component, Injectable, OnDestroy, OnInit, Pipe, PipeTransform} from '@angular/core';
import {FormBuilder, FormControl, FormGroup, Validators} from '@angular/forms';
import {forkJoin, Observable, of, Subscription} from 'rxjs';

import {ErrorService} from '../error.service';
import {ApiStorageObject, DeveloperConsoleService} from '../console.service';

@Component({
  templateUrl: './storage.component.html',
  styleUrls: ['./storage.component.scss']
})
export class StorageComponent implements OnInit, OnDestroy {
  private storageSub: Subscription;
  private deleteAllObjectsSub: Subscription;
  private importObjectsSub: Subscription;

  public error: any;
  public objects: Array<ApiStorageObject>;
  public objects_num: number;

  public filterObjectsForm: FormGroup;
  public filteredObjectsFormError: any;
  public filteredObjectsForm: boolean;

  private filter: string;

  constructor (
    private readonly consoleService: DeveloperConsoleService,
    private readonly errorService: ErrorService,
    private readonly formBuilder: FormBuilder,
  ) {}

  updateTable(filter: string) {
    this.storageSub = this.consoleService.listStorage("", filter).subscribe(data => {
      this.objects = data.objects;
      this.objects_num = data.total_count;
    }, err => {
      this.error = err;
      this.errorService.reportError(err);
    })
  }

  ngOnInit(): void {
    this.filterObjectsForm = this.formBuilder.group({
      filter: [''],
    });

    this.updateTable(this.filter);
  }

  filterObjects() {
    if (this.filterObjectsForm.invalid) {
      return;
    }
    this.error = null
    this.filter = this.filterObjectsForm.controls.filter.value;
    this.updateTable(this.filter);
  }

  deleteAllObjects() {
    this.deleteAllObjectsSub = this.consoleService.deleteStorage("").subscribe(data => {
      this.updateTable(null);
    }, err => {
      this.error = err;
      this.errorService.reportError(err);
    })
  }

  importStorage(event) {
    this.importObjectsSub = this.consoleService.importStorage("", event.target.files[0]).subscribe(data => {
      this.updateTable(null);
    }, err => {
      this.error = err;
      this.errorService.reportError(err);
    })
  }

  selectSystemObjects() {
    this.filter = "00000000-0000-0000-0000-000000000000"
    this.filterObjectsForm.controls["filter"].setValue(this.filter)
    this.error = null
    this.updateTable(this.filter);
  }

  ngOnDestroy() {
  }
}
