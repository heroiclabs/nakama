import React, {Component} from 'react';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as configurationActions from '../../store/configuration/actions';
import {Config} from '../../store/configuration/types';

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
  Notification,
  Section
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import json_to_yaml from '../../utils/json_to_yaml';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 */

interface PropsFromState
{
  loading: boolean,
  data: Config,
  errors: string|undefined
}

interface PropsFromDispatch
{
  fetchRequest: typeof configurationActions.configurationRequest
}

type Props = PropsFromState & PropsFromDispatch & ConnectedReduxProps;

class Configuration extends Component<Props>
{
  public componentDidMount()
  {
    this.props.fetchRequest();
  }
  
  private download()
  {
    const {data} = this.props;
    const element = document.createElement('a');
    const file = new Blob(
      [json_to_yaml(data, 0, [])],
      {type: 'text/yaml'}
    );
    element.href = URL.createObjectURL(file);
    element.download = 'export.yaml';
    document.body.appendChild(element);
    element.click();
  }
  
  public render()
  {
    const {data} = this.props;
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
                  <Button onClick={this.download.bind(this)}>
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
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.name}
                  />
                </Control>
              </Field.Body>
            </Field>
    
            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>data_dir</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.data_dir}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>logger.stdout</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.logger && data.config.logger.stdout}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>logger.level</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.logger && data.config.logger.level}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>logger.file</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.logger && data.config.logger.file}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>metrics.reporting_freq_sec</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.metrics && data.config.metrics.reporting_freq_sec}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>metrics.namespace</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.metrics && data.config.metrics.namespace}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>metrics.stackdriver_projectid</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.metrics && data.config.metrics.stackdriver_projectid}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>metrics.prometheus_port</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.metrics && data.config.metrics.prometheus_port}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>database.address</Label>
              </Field.Label>
              <Field.Body>
                <Field>
                  {
                    ((
                      data.config &&
                      data.config.database &&
                      data.config.database.address
                    ) || []).map((address, key) =>
                      <Control key={`address-${key}`}>
                        <Input
                          static
                          type="text"
                          placeholder="(empty)"
                          defaultValue={address}
                        />
                      </Control>
                    )
                  }
                </Field>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>database.conn_max_lifetime_ms</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.database && data.config.database.conn_max_lifetime_ms}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>runtime.env</Label>
              </Field.Label>
              <Field.Body>
                <Field>
                  {
                    ((
                      data.config &&
                      data.config.runtime &&
                      data.config.runtime.env
                    ) || []).map((env, key) =>
                      <Control key={`env-${key}`}>
                        <Input
                          static
                          type="text"
                          placeholder="(empty)"
                          defaultValue={env}
                        />
                      </Control>
                    )
                  }
                </Field>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>runtime.path</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.runtime && data.config.runtime.path}
                  />
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
                    <Input
                      static
                      type="text"
                      placeholder="(empty)"
                      defaultValue={data.config && data.config.runtime && data.config.runtime.http_key}
                    />
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
                    <Input
                      static
                      type="text"
                      placeholder="(empty)"
                      defaultValue={data.config && data.config.socket && data.config.socket.server_key}
                    />
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
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.socket && data.config.socket.port}
                  />
                </Control>
              </Field.Body>
            </Field>

            <Field horizontal marginless>
              <Field.Label size="normal">
                <Label>socket.max_message_size_bytes</Label>
              </Field.Label>
              <Field.Body>
                <Control>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={data.config && data.config.socket && data.config.socket.max_message_size_bytes}
                  />
                </Control>
              </Field.Body>
            </Field>
            <br /><br />
            {
              (data.warnings || []).map((warning, key) =>
                <Notification color="warning" key={`warning-${key}`}>
                  {warning.field}
                  <br /><br />
                  {warning.message}
                </Notification>
              )
            }
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

const mapStateToProps = ({configuration}: ApplicationState) => ({
  loading: configuration.loading,
  errors: configuration.errors,
  data: configuration.data
});

const mapDispatchToProps = (dispatch: Dispatch) => ({
  fetchRequest: () => dispatch(
    configurationActions.configurationRequest()
  )
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Configuration);
