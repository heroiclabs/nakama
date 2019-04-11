import React, {Component} from 'react';

import {
  Hero,
  Icon,
  Navbar
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import logo from '../images/logo.png';

/*
 * https://dfee.github.io/rbx/
 */

class Header extends Component
{
  public logout()
  {
    localStorage.clear();
    window.location.href = '/login';
  }
  
  public render()
  {
    return <Hero color="light">
      <Hero.Head>
        <Navbar>
          <Navbar.Brand>
            <Navbar.Item href="/status">
              <img src={logo} alt="Nav logo" />
            </Navbar.Item>
          </Navbar.Brand>
          <Navbar.Menu>
            <Navbar.Segment align="end">
              <Navbar.Item target="_blank" href="https://heroiclabs.com">
                Heroic Labs
              </Navbar.Item>
              <Navbar.Item target="_blank" href="https://cloud.heroiclabs.com">
                Managed Cloud
              </Navbar.Item>
              <Navbar.Item onClick={this.logout}>
                <Icon>
                  <FontAwesomeIcon icon="sign-out-alt" />
                </Icon>
                <span>Logout</span>
              </Navbar.Item>
            </Navbar.Segment>
          </Navbar.Menu>
        </Navbar>
      </Hero.Head>
    </Hero>;
  }
}

export default Header;
