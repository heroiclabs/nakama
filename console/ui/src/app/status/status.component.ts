
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
import {forkJoin, Subject, Observable, of, Subscription, timer} from 'rxjs';

import {AuthenticationService} from '../authentication.service';
import {ErrorService} from '../error.service';
import {StatusListStatus, StatusList, DeveloperConsoleService} from '../console.service';

interface Datapoint {
  name: any;
  value: any;
}

interface Series {
  name: string;
  series: Array<Datapoint>;
}

@Component({
  templateUrl: './status.component.html',
  styleUrls: ['./status.component.scss']
})
export class StatusComponent implements OnInit, OnDestroy {
  public nodeStats: StatusListStatus[];
  private nodeStatsSub: Subscription;
  private updateSub: Subscription;
  public error: any; 

  private historyData: Map<string, Map<string, Series>>;
  public plotDataLatency: Array<Series>;
  public plotDataRate: Array<Series>;
  public plotDataInput: Array<Series>;
  public plotDataOutput: Array<Series>;

  legend = false;
  animations = true;
  showYAxisLabel = false;
  showXAxisLabel = false;
  timeline = false;
  autoScale = true;
  colorScheme = {
    domain: ['#5AA454', '#E44D25', '#1e59cf', '#7aa3e5', '#a8385d', '#d0bd00']
  };

  constructor (
    private readonly consoleService: DeveloperConsoleService,
    private readonly errorService: ErrorService,
    private readonly authenticationService: AuthenticationService,
  ) {}

  getLimitedLengthArray(length: number): Array<any> {
    var array = new Array();
    array.push = function () {
      if (this.length >= length) {
        this.shift();
      }
      return Array.prototype.push.apply(this, arguments);
    }
    return array;
  }

  ngOnInit(): void {
    this.historyData = new Map<string, Map<string, Series>>();
    const HISTORY_LEN = 100;
    const UPDATE_PERIOD = 1000;
    const METRICS = [ 'latency', 'rate', 'input', 'output' ];

    for (var metric of METRICS) {
      this.historyData.set(metric, new Map<string, Series>());
    }

    this.updateSub = timer(0, UPDATE_PERIOD).subscribe(
      _ => {
        this.nodeStatsSub = this.consoleService.getStatus("").subscribe(data => {
          this.nodeStats = data.nodes

          for (var metric of METRICS) {
            for (var node of data.nodes) {
              var name = new Date().toLocaleString();
              var value = 0;
              switch (metric) {
                case 'latency': value = node.avg_latency_ms; break;
                case 'rate'   : value = node.avg_rate_sec; break;
                case 'input'  : value = node.avg_input_kbs; break;
                case 'output' : value = node.avg_output_kbs; break;
                default:
                  console.log("unsupported metric " + metric);
              }
              let datapoint = {
                name: name,
                value: value ? value : 0,
              }
              if (!this.historyData.get(metric).has(node.name)) {
                this.historyData.get(metric).set(node.name, { name: node.name, series: this.getLimitedLengthArray(HISTORY_LEN) })
              }
              this.historyData.get(metric).get(node.name).series.push(datapoint);
            }
          }

          this.plotDataLatency = Array.from(this.historyData.get('latency').values());
          this.plotDataRate = Array.from(this.historyData.get('rate').values());
          this.plotDataInput = Array.from(this.historyData.get('input').values());
          this.plotDataOutput = Array.from(this.historyData.get('output').values());
        }, err => {
          this.error = err;
          this.errorService.reportError(err);
          this.updateSub.unsubscribe();
        })
      }
    )
  }

  ngOnDestroy() {
  }
}
