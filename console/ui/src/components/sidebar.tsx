import React, {Component} from 'react';
import {Link} from 'react-router-dom';
import cn from 'classnames';
import {Column, Menu} from 'rbx';

/*
 * https://dfee.github.io/rbx/
 */

type Props = {
  active: string;
};

type State = {
};

class Sidebar extends Component<Props, State>
{
  public render()
  {
    return <Column size={2}>
      <Menu>
        <Menu.List>
          <Menu.List.Item as="span">
            <Link
              to="/status"
              className={cn({'is-active': this.props.active === 'status'})}
            >Status</Link>
          </Menu.List.Item>
          <Menu.List.Item as="span">
            <Link
              to="/configuration"
              className={cn({'is-active': this.props.active === 'configuration'})}
            >Configuration</Link>
          </Menu.List.Item>
          <Menu.List.Item as="span">
            <Link
              to="/users"
              className={cn({'is-active': this.props.active === 'users'})}
            >Users</Link>
          </Menu.List.Item>
          <Menu.List.Item as="span">
            <Link
              to="/storage"
              className={cn({'is-active': this.props.active === 'storage'})}
            >Storage</Link>
          </Menu.List.Item>
        </Menu.List>

        <Menu.Label>Resources</Menu.Label>
        <Menu.List>
          <Menu.List.Item
            target="_blank"
            href="https://heroiclabs.com/docs"
          >Documentation</Menu.List.Item>
          <Menu.List.Item
            target="_blank"
            href="mailto:sales@heroiclabs.com"
          >Support</Menu.List.Item>
          <Menu.List.Item
            target="_blank"
            href="https://gitter.im/heroiclabs/nakama"
          >Community</Menu.List.Item>
        </Menu.List>
      </Menu>
    </Column>;
  }
}

export default Sidebar;
