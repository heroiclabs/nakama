import React, {Component} from 'react';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as configurationActions from '../../store/configuration/actions';
import {Config, Warning} from '../../store/configuration/types';

import {Button, Column, Control, Field, Generic, Icon, Input, Label, Level, Section} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import json_to_yaml from '../../utils/json_to_yaml';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

interface PropsFromState {
  loading: boolean,
  data: Config,
  errors: string | undefined
}

interface PropsFromDispatch {
  fetchRequest: typeof configurationActions.configurationRequest
}

type Props = PropsFromState & PropsFromDispatch & ConnectedReduxProps;

class Configuration extends Component<Props> {
  public componentDidMount() {
    this.props.fetchRequest();
  }

  private download() {
    const {data} = this.props;
    const element = document.createElement('a');
    const file = new Blob(
      [json_to_yaml(data.config, 0, [])],
      {type: 'text/yaml'}
    );
    element.href = URL.createObjectURL(file);
    element.download = 'config.yaml';
    document.body.appendChild(element);
    element.click();
  }

  public render_node(key: string, value: any, warnings: Warning[]): React.ReactNode {
    const warning = warnings.find(w => w.field === key);
    if (Array.isArray(value)) {
      return <Field key={key} horizontal marginless>
        <Field.Label size="normal">
          <Label>{key}</Label>
        </Field.Label>
        <Field.Body>
          <Field>
            {
              value.map((subvalue, subkey) =>
                <Control key={`${key}.${subkey}`}>
                  <Input
                    static
                    type="text"
                    placeholder="(empty)"
                    defaultValue={subvalue}
                  />
                </Control>
              )
            }
            {warning ? <p className="help is-danger">{warning.message}</p> : null}
          </Field>
        </Field.Body>
      </Field>;
    } else if (value !== null && typeof value === 'object') {
      return Object.keys(value).map(subkey => this.render_node(
        `${key}${key ? '.' : ''}${subkey}`,
        value[subkey],
        warnings
      ));
    } else {
      return <Field key={key} horizontal marginless>
        <Field.Label size="normal">
          <Label>{key}</Label>
        </Field.Label>
        <Field.Body>
          <Field>
            <Control>
              <Input
                static
                type="text"
                placeholder="(empty)"
                defaultValue={value}
              />
            </Control>
            {warning ? <p className="help is-danger">{warning.message}</p> : null}
          </Field>
        </Field.Body>
      </Field>;
    }
  }

  public render() {
    const {data} = this.props;
    return <Generic id="configuration">
      <Header/>
      <Section>
        <Column.Group>
          <Sidebar active="configuration"/>

          <Column>
            <Level>
              <Level.Item align="left"/>

              <Level.Item align="right">
                <Level.Item>
                  <Button onClick={this.download.bind(this)}>
                    <Icon>
                      <FontAwesomeIcon icon="file-export"/>
                    </Icon>
                    <span>Export</span>
                  </Button>
                </Level.Item>
              </Level.Item>
            </Level>

            <Field key="version" horizontal marginless>
              <Field.Label size="normal">
                <Label>version</Label>
              </Field.Label>
              <Field.Body>
                <Field>
                  <Control>
                    <Input
                      static
                      type="text"
                      placeholder=""
                      defaultValue={data.server_version}
                    />
                  </Control>
                </Field>
              </Field.Body>
            </Field>
            {data.config && this.render_node('', data.config, data.warnings || [])}
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
