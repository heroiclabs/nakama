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

class UsersDetails extends Component<Props, State>
{
  render()
  {
    return <Generic id="users_details">
      <Header />
      <section className="section">
        <div className="columns">
          <Sidebar active="users" />
    
          <main className="column main">
            <div className="level">
              <div className="level-left">
                <div className="level-item">
                  <nav className="breadcrumb" aria-label="breadcrumbs">
                    <ul>
                      <li><a href="page-users.html">Users</a></li>
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
                    <span className="icon"><i className="fa fa-ban"></i></span>
                    <span>Ban</span>
                  </a>
                </p>
                <p className="level-item">
                  <a className="button">
                    <span className="icon"><i className="fa fa-trash"></i></span>
                    <span>Delete</span>
                  </a>
                </p>
                <p className="level-item">
                  <a className="button">
                    <span className="icon"><i className="fa fa-trash"></i></span>
                    <span>Recorded Delete</span>
                  </a>
                </p>
              </div>
            </div>
    
            <div className="tabs">
              <ul>
                <li className="is-active"><a href="page-user-details.html">Profile</a></li>
                <li><a href="page-user-details-account.html">Account</a></li>
                <li><a href="page-user-details-friends.html">Friends &nbsp;<span className="tag">7</span></a></li>
                <li><a href="page-user-details-groups.html">Groups</a></li>
                <li><a href="page-user-details-wallet.html">Wallet</a></li>
                <li>
                  <a href="page-storage.html">
                    <span>Storage</span>
                    <span className="icon is-small"><i className="fas fa-link" aria-hidden="true"></i></span>
                  </a>
                </li>
              </ul>
            </div>
    
            <div className="columns">
              <div className="column is-6">
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">ID</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input is-static" type="text" value="001b0970-3291-4176-b0da-a7743c3036e3" disabled />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Username</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" placeholder="(empty)" value="JNbhSTvuNj" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Display Name</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" placeholder="(empty)" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Metadata</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <div className="control">
                        <textarea className="textarea" placeholder="Metadata" rows={6}>
                        {`{
                          "daily_reward_reset": 1547381190,
                          "daily_reward_position": 12,
                          "vip": false
                        }`}
                        </textarea>
                      </div>
                    </div>
                  </div>
                </div>
    
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
    
              <div className="column is-6">
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Facebook ID</label>
                  </div>
                  <div className="field-body">
                    <div className="field has-addons">
                      <p className="control is-expanded">
                        <input className="input" type="text" value="1810399758992730" disabled />
                      </p>
                      <p className="control">
                        <a className="button">Unlink</a>
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Game Center ID</label>
                  </div>
                  <div className="field-body">
                    <div className="field has-addons">
                      <p className="control is-expanded">
                        <input className="input" type="text" value="G:1026207127" disabled />
                      </p>
                      <p className="control">
                        <a className="button">Unlink</a>
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Google ID</label>
                  </div>
                  <div className="field-body">
                    <div className="field has-addons">
                      <p className="control is-expanded">
                        <input className="input" type="text" value="114522506190423282632" disabled />
                      </p>
                      <p className="control">
                        <a className="button">Unlink</a>
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Steam ID</label>
                  </div>
                  <div className="field-body">
                    <div className="field has-addons">
                      <p className="control is-expanded">
                        <input className="input" type="text" value="steamusername1" disabled />
                      </p>
                      <p className="control">
                        <a className="button">Unlink</a>
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Avatar URL</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" placeholder="(empty)" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Lang Tag</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" placeholder="(empty)" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Location</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" placeholder="(empty)" />
                      </p>
                    </div>
                  </div>
                </div>
    
                <div className="field is-horizontal">
                  <div className="field-label is-normal">
                    <label className="label">Timezone</label>
                  </div>
                  <div className="field-body">
                    <div className="field">
                      <p className="control">
                        <input className="input" type="text" placeholder="(empty)" />
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

export default UsersDetails;
