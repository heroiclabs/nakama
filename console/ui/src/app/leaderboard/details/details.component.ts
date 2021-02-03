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
import {Leaderboard} from '../../console.service';
import {ActivatedRoute} from '@angular/router';
import * as ace from 'ace-builds';

@Component({
  templateUrl: './details.component.html',
  styleUrls: ['./details.component.scss']
})
export class LeaderboardDetailsComponent implements OnInit, AfterViewInit {
  @ViewChild('editor') private editor: ElementRef<HTMLElement>;

  public orderString = {
    0: 'Ascending',
    1: 'Descending',
  };
  public operatorString = {
    0: 'Best',
    1: 'Set',
    2: 'Increment',
    3: 'Decrement',
  };

  private aceEditor: ace.Ace.Editor;
  public leaderboard: Leaderboard;
  public error = '';

  constructor(private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.parent.data.subscribe(
      d => {
        this.leaderboard = d[0];
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
    this.aceEditor.setReadOnly(true);

    if (this.leaderboard.metadata) {
      const value = JSON.stringify(JSON.parse(this.leaderboard.metadata), null, 2);
      this.aceEditor.session.setValue(value);
    }
  }
}
