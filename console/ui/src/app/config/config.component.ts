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
import {HttpClient, HttpHeaders, HttpParams} from '@angular/common/http';

@Component({
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss']
})
export class ConfigComponent implements OnInit, OnDestroy {
  public configError: any;
  public uploadError: any;
  public jsonConfig: any;
  public flatConfig: any;
  public file: NgxFileDropEntry;
  public uploading = false;
  public uploadSuccess = false;

  private host: string;

  constructor(
    private readonly config: ConfigParams,
    private readonly route: ActivatedRoute,
    private readonly httpClient: HttpClient,
  ) {
    this.host = config.host;
  }

  ngOnInit(): void {
    this.route.data.subscribe(
    d => {
      const json = JSON.parse(d[0].config);
      this.jsonConfig = json;
      this.flatConfig = this.flattenConfig(json);
    },
    err => {
      this.configError = err;
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
      if (Array.isArray(config[key])) {
        flattened.push({
          name: prefix + key,
          value: config[key].join(),
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

  ngOnDestroy(): void {
  }

  public fileOver(event): void {
    console.log(event);
  }

  public fileLeave(event): void {
    console.log(event);
  }

  public dropped(files: NgxFileDropEntry[]): void {
    const file = files[0];

    if (file.fileEntry.isFile) {
      const fileEntry = file.fileEntry as FileSystemFileEntry;
      fileEntry.file((f: File) => {
        this.uploadFile(f, file.relativePath);
      });
    }
  }

  private uploadFile(f: File, relPath: string): void {
    const formData = new FormData();
    formData.append('logo', f, relPath);
    this.uploading = true;

    const headers = new HttpHeaders().set('Content-Type', f.type);
    this.httpClient.post('/v2/console/storage/import', formData, {headers}).subscribe(r => {
      this.uploading = false;
      this.uploadSuccess = true;
    }, err => {
      this.uploadError = err;
    });
  }
}

@Injectable({providedIn: 'root'})
export class ConfigResolver implements Resolve<Observable<Config>> {
  constructor(private readonly consoleService: ConsoleService) {}

  resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<Config> {
    return this.consoleService.getConfig('');
  }
}
