import React, {Component} from 'react';
import {Hero, Icon} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import logo from '../images/logo.png';

/*
 * https://dfee.github.io/rbx/
 */

class Header extends Component
{
  public render()
  {
    return <Hero color="light">
      <Hero.Head>
        <nav className="navbar has-shadow" role="navigation" aria-label="main navigation">
          <div className="navbar-brand">
            <a href="page-status.html" className="navbar-item">
              <img src={logo} alt="Nav logo" />
            </a>
            <span className="navbar-burger burger" data-target="navbarMenu" aria-label="menu" aria-expanded="false">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </span>
          </div>
          <div id="navbarMenu" className="navbar-menu">
            <div className="navbar-end">
              <a className="navbar-item" target="_blank" href="https://heroiclabs.com">
                <span>Heroic Labs</span>
              </a>
              <a className="navbar-item" target="_blank" href="https://cloud.heroiclabs.com">
                <span>Managed Cloud</span>
              </a>
              <a className="navbar-item" href="page-login.html">
                <Icon>
                  <FontAwesomeIcon icon="sign-out-alt" />
                </Icon>
                <span>Logout</span>
              </a>
            </div>
          </div>
        </nav>
      </Hero.Head>
    </Hero>;
  }
}

export default Header;
