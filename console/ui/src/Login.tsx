import React, {Component} from 'react';
import {Button, Card, Checkbox, Column, Container, Control, Field, Hero, Input, Label} from 'rbx';
import './Login.css';
import logo from './login-nakamaicon.png';

class Login extends Component {
  render() {
    return (
      <Hero size="fullheight">
        <Hero.Body>
          <Container textAlign="centered">
            <img src={logo} alt="logo" width="200" style={{marginBottom: "0.5rem"}}/>
            <Column.Group centered gapless>
              <Column size="one-third">
                <Card>
                  <Card.Header>
                    <Card.Header.Title>Developer Console</Card.Header.Title>
                  </Card.Header>
                  <Card.Content>
                    <form>
                      <Field>
                        <Control>
                          <Input type="text" placeholder="Your username" autoFocus/>
                        </Control>
                      </Field>
                      <Field>
                        <Control>
                          <Input type="password" placeholder="Your password"/>
                        </Control>
                      </Field>
                      <Field>
                        <Label>
                          <Checkbox/> Remember me
                        </Label>
                      </Field>
                      <Button color="info" fullwidth>Login</Button>
                    </form>
                  </Card.Content>
                </Card>
              </Column>
            </Column.Group>
            <p className="has-text-grey">
              <a target="_blank"
                 href="https://heroiclabs.com">Website</a>{'\u00A0\u00A0\u2022\u00A0\u00A0'}
              <a target="_blank"
                 href="https://heroiclabs.com/managed-cloud">Managed Cloud</a>{'\u00A0\u00A0\u2022\u00A0\u00A0'}
              <a target="_blank"
                 href="https://heroiclabs.com/docs">Documentation</a>{'\u00A0\u00A0\u2022\u00A0\u00A0'}
              <a target="_blank"
                 href="https://github.com/heroiclabs/nakama">GitHub</a>
            </p>
            <p className="is-size-7">{'Made with \u2665 by Heroic Labs.'}</p>
          </Container>
        </Hero.Body>
      </Hero>
    );
  }
}

export default Login;
