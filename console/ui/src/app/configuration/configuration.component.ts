
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
import {forkJoin, Observable, of, Subscription} from 'rxjs';

import {ConfigurationService} from '../configuration.service';
import {Config} from '../console.service';
import {ErrorService} from '../error.service';

@Component({
  templateUrl: './configuration.component.html',
  styleUrls: ['./configuration.component.scss']
})
export class ConfigurationComponent implements OnInit, OnDestroy {
  public config: any;
  private configSub: Subscription;
  public error: any;

  constructor (
    private readonly configurationService: ConfigurationService,
    private readonly errorService: ErrorService,
  ) {}

  ngOnInit(): void {
    function flatten(parent, obj){
      let ret = [];
      for (var key in obj) {
        if (typeof obj[key] == "object" && obj[key] !== null) {
          ret = ret.concat(flatten(parent + (parent ? '.' : '') + key, obj[key]))
        } else {
          ret.push({key: parent + (parent ? '.' : '') + key, value: obj[key]})
        }
      }
      return ret
    }

    this.configSub = this.configurationService.getConfig().subscribe(data => {
      let config = JSON.parse(data.config)
      this.config = flatten("", config)
    }, err => {
      this.error = err;
      this.errorService.reportError(err);
    })
  }

  ngOnDestroy() {
  }
}
