import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as loginActions from '../../store/login/actions';
import {LoginRequest, Token} from '../../store/login/types';

import {
  Button,
  Card,
  Checkbox,
  Column,
  Container,
  Control,
  Field,
  Hero,
  Notification,
  Input,
  Label
} from 'rbx';

import logo from '../../images/logo.png';

/*
 * https://dfee.github.io/rbx/
 */

interface PropsFromState
{
  loading: boolean,
  data: Token,
  errors: string|undefined
}

interface PropsFromDispatch
{
  fetchRequest: typeof loginActions.loginRequest
}

type Props = RouteComponentProps & PropsFromState & PropsFromDispatch & ConnectedReduxProps;

class Login extends Component<Props>
{
  componentWillReceiveProps(nextProps: Props)
  {
    if(nextProps.data && nextProps.data.token)
    {
      const {history} = this.props;
      history.push('/status');
    }
  }

  login(event: React.FormEvent<HTMLFormElement>)
  {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    const payload = {
      username: data.get('username') as string,
      password: data.get('password') as string,
      remember: !!data.get('remember')
    };
    this.props.fetchRequest(payload);
  }
  
  render()
  {
    return <Hero id="login" size="fullheight">
      <Hero.Body>
        <Container textAlign="centered">
          <img src={logo} alt="logo" />
          <Column.Group centered gapless>
            <Column size="one-third">
              {
                this.props.errors ?
                <Notification color="danger">Your credentials are invalid.</Notification> :
                null
              }
              <Card>
                <Card.Header>
                  <Card.Header.Title>Developer Console</Card.Header.Title>
                </Card.Header>
                <Card.Content>
                  <form onSubmit={this.login.bind(this)}>
                    <Field>
                      <Control>
                        <Input type="text" name="username" placeholder="Your username" autoFocus />
                      </Control>
                    </Field>
                    <Field>
                      <Control>
                        <Input type="password" name="password" placeholder="Your password" />
                      </Control>
                    </Field>
                    <Field>
                      <Label>
                        <Checkbox name="remember" /> Remember me
                      </Label>
                    </Field>
                    <Button color="info" fullwidth>Login</Button>
                  </form>
                </Card.Content>
              </Card>
            </Column>
          </Column.Group>
          <p className="has-text-grey">
            <a target="_blank" href="https://heroiclabs.com">Website</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a target="_blank" href="https://heroiclabs.com/managed-cloud">Managed Cloud</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a target="_blank" href="https://heroiclabs.com/docs">Documentation</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a target="_blank" href="https://github.com/heroiclabs/nakama">GitHub</a>
          </p>
          <p className="is-size-7">Made with &hearts; by Heroic Labs.</p>
        </Container>
      </Hero.Body>
    </Hero>;
  }
}

const mapStateToProps = ({login}: ApplicationState) => ({
  loading: login.loading,
  errors: login.errors,
  data: login.data
});

const mapDispatchToProps = (dispatch: Dispatch) => ({
  fetchRequest: (data: LoginRequest) => dispatch(
    loginActions.loginRequest(data)
  )
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Login);
