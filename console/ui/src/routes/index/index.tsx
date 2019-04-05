import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';
import {Generic} from 'rbx';

/*
 * https://dfee.github.io/rbx/
 */

class Index extends Component<RouteComponentProps>
{
  public componentDidMount()
  {
    const {history} = this.props;
    if(localStorage.getItem('token'))
    {
      history.push('/status');
    }
    else
    {
      history.push('/login');
    }
  }
  
  public render()
  {
    return <Generic id="index" />;
  }
}

export default Index;
