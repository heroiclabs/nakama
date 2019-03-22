import React, {Component} from 'react';
import {Button, Card, Checkbox, Column, Container, Control, Field, Hero, Input, Label} from 'rbx';

import logo from '../../images/logo.png';

/*
 * https://dfee.github.io/rbx/
 */

class Login extends Component
{
  login(event: React.FormEvent<HTMLFormElement>)
  {
    event.preventDefault();
    window.location.href = '/status';
  }
  
  render()
  {
    return <Hero id="login" size="fullheight">
      <Hero.Body>
        <Container textAlign="centered">
          <img src={logo} alt="logo" />
          <Column.Group centered gapless>
            <Column size="one-third">
              <Card>
                <Card.Header>
                  <Card.Header.Title>Developer Console</Card.Header.Title>
                </Card.Header>
                <Card.Content>
                  <form onSubmit={this.login}>
                    <Field>
                      <Control>
                        <Input type="text" placeholder="Your username" autoFocus />
                      </Control>
                    </Field>
                    <Field>
                      <Control>
                        <Input type="password" placeholder="Your password" />
                      </Control>
                    </Field>
                    <Field>
                      <Label>
                        <Checkbox /> Remember me
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

export default Login;
