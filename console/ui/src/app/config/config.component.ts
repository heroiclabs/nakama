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

import {Component, Injectable, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, ActivatedRouteSnapshot, Resolve, RouterStateSnapshot} from '@angular/router';
import {Config, ConfigParams, ConsoleService} from '../console.service';
import {Observable} from 'rxjs';
import {safeDump} from 'js-yaml';
import * as FileSaver from 'file-saver';
import {FileSystemFileEntry, NgxFileDropEntry} from 'ngx-file-drop';
import {HttpClient} from '@angular/common/http';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {delay} from 'rxjs/operators';
import {UntypedFormBuilder, UntypedFormGroup, Validators} from '@angular/forms';
import {DeleteConfirmService} from '../shared/delete-confirm.service';

@Component({
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss']
})
export class ConfigComponent implements OnInit, OnDestroy {
  public configError = '';
  public uploadError = '';
  public deleteError = '';
  public jsonConfig: any;
  public flatConfig: any;
  public nakamaVersion: string;
  public file: NgxFileDropEntry;
  public uploading = false;
  public uploadSuccess = false;
  public deleteSuccess = false;
  public deleting = false;
  public confirmDeleteForm: UntypedFormGroup;

  private apiConfig: ConfigParams;

  constructor(
    private readonly config: ConfigParams,
    private readonly route: ActivatedRoute,
    private readonly httpClient: HttpClient,
    private readonly modalService: NgbModal,
    private readonly consoleService: ConsoleService,
    private readonly formBuilder: UntypedFormBuilder,
    private readonly deleteConfirmService: DeleteConfirmService,
  ) {
    this.apiConfig = config;
  }

  ngOnInit(): void {
    this.route.data.subscribe(
    d => {
      this.nakamaVersion = d[0].server_version;
      const json = JSON.parse(d[0].config);
      this.jsonConfig = json;
      this.flatConfig = this.flattenConfig(json);
    },
    err => {
      this.configError = err;
    });
    this.confirmDeleteForm = this.formBuilder.group({
      delete: ['', Validators.compose([Validators.required, Validators.pattern('DELETE')])],
    });
  }

  private flattenConfig(config: Config): any {
    const flatConfig = [];
    this.traverseConfig('', config, flatConfig);
    const sortedConfig = flatConfig.sort((a, b) => a.name.localeCompare(b.name));
    return sortedConfig;
  }

  private traverseConfig(prefix: string, config: any, flattened: any[]): void {
    for (const key in config) {
      if (key === 'env') {
        // we'll separate out runtime environments into its own config handling
        continue;
      }

      if (Array.isArray(config[key])) {
        flattened.push({
          name: prefix + key,
          value: config[key].join(', '),
        });
      } else if (typeof config[key] === 'object') {
        this.traverseConfig(key + '.', config[key], flattened);
      } else {
        flattened.push({
          name: prefix + key,
          value: config[key],
        });
      }
    }
  }

  public isEmpty(value: any): boolean {
    if (value === '') {
      return true;
    } else if (value === 0) {
      return true;
    } else {
      return false;
    }
  }

  public exportYaml(): void {
    const blob = new Blob([safeDump(this.jsonConfig)], {type: 'text/yaml;charset=utf-8'});
    FileSaver.saveAs(blob, 'config.yaml');
  }

  public dropped(files: NgxFileDropEntry[]): void {
    this.uploadError = '';
    this.uploadSuccess = false;

    for (const file of files) {
      if (file.fileEntry.isFile) {
        const tokens = file.fileEntry.name.split('.');
        const validExt = ['json', 'csv'];
        if (tokens.length > 1 && validExt.includes(tokens[tokens.length - 1].toLowerCase())) {
          const fileEntry = file.fileEntry as FileSystemFileEntry;
          fileEntry.file((f: File) => {
            this.uploadFile(f);
          });
        } else {
          this.uploadError = 'Invalid file: must have extension .json or .csv';
        }
      }
    }
  }

  private uploadFile(f: File): void {
    const formData = new FormData();
    formData.append(f.name, f);
    this.uploading = true;
    const headers = {
      Authorization: 'Bearer ',
    };
    this.httpClient.post(this.apiConfig.host + '/v2/console/storage/import', formData, {headers}).subscribe(() => {
      this.uploading = false;
      this.uploadSuccess = true;
    }, err => {
      this.uploading = false;
      this.uploadError = err;
    });
  }

  public deleteData(): void {
    this.deleteConfirmService.openDeleteConfirmModal(
      () => {
        this.deleteError = '';
        this.deleting = true;
        this.consoleService.deleteAllData('').pipe(delay(2000)).subscribe(
          () => {
            this.deleting = false;
            this.deleteError = '';
            this.deleteSuccess = true;
          }, err => {
            this.deleting = false;
            this.deleteError = err;
          },
        );
      },
      this.confirmDeleteForm,
      'Delete All Data' ,
     'Are you sure you want to delete all the database data?'
    );
  }

  get f(): any {
    return this.confirmDeleteForm.controls;
  }

  ngOnDestroy(): void {
  }
}

@Injectable({providedIn: 'root'})
export class ConfigResolver implements Resolve<Config> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<Config> {
    return this.consoleService.getConfig('');
  }
}
