import React, {Component} from 'react';
import {Generic} from 'rbx';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 */

type Props = {
  id: string;
};

type State = {
};

class StorageDetails extends Component<Props, State>
{
  render()
  {
    return <Generic id="storage_details">
      <Header />
      <section className="section">
        <div className="columns">
          <Sidebar active="storage" />
    
          <main className="column main">
            <div className="level">
              <div className="level-left">
                <div className="level-item">
                  <nav className="breadcrumb" aria-label="breadcrumbs">
                    <ul>
                      <li><a href="page-storage.html">Storage</a></li>
                      <li className="is-active"><a href="#">savegames</a></li>
                      <li className="is-active"><a href="#">slot1</a></li>
                      <li className="is-active"><a href="#" aria-current="page">001b0970-3291-4176-b0da-a7743c3036e3</a></li>
                    </ul>
                  </nav>
                </div>
              </div>
              <div className="level-right">
                <p className="level-item">
                  <a className="button">
                    <span className="icon"><i className="fa fa-file-export"></i></span>
                    <span>Export</span>
                  </a>
                </p>
                <p className="level-item">
                  <a className="button">
                    <span className="icon"><i className="fa fa-trash"></i></span>
                    <span>Delete</span>
                  </a>
                </p>
              </div>
            </div>
    
            <div className="columns">
              <div className="column is-6">
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Collection</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" value="savegames" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Key</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" value="slot1" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">User ID</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" value="001b0970-3291-4176-b0da-a7743c3036e3" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Version</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input is-static" type="text" value="8f2d67f3755c2cffd9187c178f9b9b36" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Read Permission</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <div className="control">
                        <div className="select">
                          <select>
                            <option value="0">No Read (0)</option>
                            <option value="1" selected>Private Read (1)</option>
                            <option value="2">Public Read (2)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Write Permission</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <div className="select">
                          <select>
                            <option value="0">No Write (0)</option>
                            <option value="1" selected>Private Write (1)</option>
                          </select>
                        </div>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
    
            <div className="columns">
              <div className="column">
                <div className="field">
                  <label className="label">Value</label>
                  <div className="field">
                    <div className="control">
                      <textarea className="textarea" placeholder="Value" rows={8}>
                      {`{
                        "recipients": [
                          "6197da87-8219-43d0-a631-034d2a485c27",
                          "7d6429f2-ab63-4570-ac63-ab6d6bc4382f"
                        ],
                        "reset_timestamp": 0
                      }`}
                      </textarea>
                    </div>
                  </div>
                </div>
              </div>
            </div>
    
            <div className="columns">
              <div className="column is-6">
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Create Time</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input is-static" type="text" value="2018-08-07 11:29:36.764366+00:00" disabled />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Update Time</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input is-static" type="text" value="2018-08-07 11:29:36.764366+00:00" disabled />
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
    
            <div className="field is-grouped is-grouped-right">
              <div className="control">
                <button className="button is-link" type="submit">Update</button>
              </div>
            </div>
          </main>
        </div>
      </section>
    </Generic>;
  }
}

export default StorageDetails;
