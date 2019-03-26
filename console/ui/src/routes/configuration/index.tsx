import React, {Component} from 'react';
import {
  Button,
  Column,
  Control,
  Field,
  Generic,
  Icon,
  Input,
  Label,
  Level,
  Section
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 */

class Configuration extends Component
{
  render()
  {
    return <Generic id="configuration">
      <Header />
      <Section>
        <Column.Group>
          <Sidebar active="configuration" />

          <Column>
            <Level>
              <Level.Item align="left" />
    
              <Level.Item align="right">
                <Level.Item>
                  <Button>
                    <Icon>
                      <FontAwesomeIcon icon="file-export" />
                    </Icon>
                    <span>Export</span>
                  </Button>
                </Level.Item>
              </Level.Item>
            </Level>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>name</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="nakama-0" />
                </Control>
              </Field.Body>
            </Field>
    
            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>data_dir</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="/Users/user1/Projects/mygame" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>logger.stdout</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="false" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>logger.level</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="warn" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>logger.file</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="/tmp/path/to/logfile.log" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>metrics.reporting_freq_sec</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="60" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>metrics.namespace</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>metrics.stackdriver_projectid</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>metrics.prometheus_port</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="0" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>database.address</Label>
              </Field.Label>
              <Field.Body>
                <Field>
                  <Control>
                    <Input static type="text" placeholder="(empty)" value="root@127.0.0.1:26257" />
                  </Control>
                  <Control>
                    <Input static type="text" placeholder="(empty)" value="root@127.0.0.24:26257" />
                  </Control>
                </Field>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>database.conn_max_lifetime_ms</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="0" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>runtime.env</Label>
              </Field.Label>
              <Field.Body>
                <Field>
                  <Control>
                    <Input static type="text" placeholder="(empty)" value="example_apikey=example_apivalue" />
                  </Control>
                  <Control>
                    <Input static type="text" placeholder="(empty)" value="encryptionkey=afefa==e332*u13=971mldq" />
                  </Control>
                </Field>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>runtime.path</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="/Users/user1/Projects/mygame/modules" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>runtime.http_key</Label>
              </Field.Label>
              <Field.Body>
                <Field>
                  <Control>
                    <Input static type="text" placeholder="(empty)" value="&#65121;&#65121;&#65121;&#65121;&#65121;&#65121;&#65121;&#65121;" />
                  </Control>
                  <p className="help is-danger">This value must be changed in production.</p>
                </Field>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>socket.server_key</Label>
              </Field.Label>
              <Field.Body>
                <Field>
                  <Control>
                    <Input static type="text" placeholder="(empty)" value="&#65121;&#65121;&#65121;&#65121;&#65121;&#65121;&#65121;&#65121;" />
                  </Control>
                  <p className="help is-danger">This value must be changed in production.</p>
                </Field>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>socket.port</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="7350" />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>socket.max_message_size_bytes</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input static type="text" placeholder="(empty)" value="4096" />
                </Control>
              </Field.Body>
            </Field>
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

export default Configuration;
