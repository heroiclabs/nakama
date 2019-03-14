import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';
import {Link} from 'react-router-dom';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as storageActions from '../../store/storage/actions';
import {StorageObject, StorageObjectRequest} from '../../store/storage/types';

import {
  Breadcrumb,
  Button,
  Column,
  Control,
  Dropdown,
  Field,
  Generic,
  Icon,
  Input,
  Label,
  Level,
  Notification,
  Section,
  Select,
  Textarea
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import json_to_csv from '../../utils/json_to_csv';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 */

interface PropsFromState {
  loading: boolean,
  errors: string | undefined,
  updated: boolean,
  data: StorageObject
}

interface PropsFromDispatch {
  fetchRequest: typeof storageActions.storageFetchRequest,
  updateRequest: typeof storageActions.storageUpdateRequest,
  deleteRequest: typeof storageActions.storageDeleteRequest
}

type Props = RouteComponentProps & PropsFromState & PropsFromDispatch & ConnectedReduxProps;

type State = {};

class StorageDetails extends Component<Props, State> {
  public componentDidMount() {
    const {match} = this.props;
    this.props.fetchRequest(match.params);
  }

  public key(prefix: string) {
    const {data} = this.props;
    return `${prefix}_${data.collection}_${data.key}_${data.user_id}_${data.update_time}`;
  }

  public update(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    const payload = {
      collection: data.get('collection') as string,
      key: data.get('key') as string,
      user_id: data.get('user_id') as string,
      permission_read: parseInt(data.get('permission_read') as string),
      permission_write: parseInt(data.get('permission_write') as string),
      value: data.get('value') as string,
      version: data.get('version') as string
    };
    this.props.updateRequest(payload);
  }

  public remove() {
    const {match, history} = this.props;
    if (confirm('Are you sure you want to delete this object?')) {
      this.props.deleteRequest(match.params);
      history.goBack();
    }
  }

  public download(format: string) {
    const {data} = this.props;
    const element = document.createElement('a');
    let file;
    if (format === 'json') {
      file = new Blob(
        [JSON.stringify([data], null, 2)],
        {type: 'application/json'}
      );
    } else {
      file = new Blob(
        [json_to_csv([data])],
        {type: 'text/plain'}
      );
    }
    element.href = URL.createObjectURL(file);
    element.download = `export.${format}`;
    document.body.appendChild(element);
    element.click();
  }

  public render() {
    const {data, updated, errors} = this.props;
    return <Generic id="storage_details">
      <Header/>
      <Section>
        <Column.Group>
          <Sidebar active="storage"/>

          <Column>
            <Level>
              <Level.Item align="left">
                <Level.Item>
                  <Breadcrumb>
                    <Breadcrumb.Item as="span"><Link to="/storage">Storage</Link></Breadcrumb.Item>
                    <Breadcrumb.Item active>{data.collection}</Breadcrumb.Item>
                    <Breadcrumb.Item active>{data.key}</Breadcrumb.Item>
                    <Breadcrumb.Item active>{data.user_id}</Breadcrumb.Item>
                  </Breadcrumb>
                </Level.Item>
              </Level.Item>
              <Level.Item align="right">
                <Level.Item>
                  <Dropdown hoverable>
                    <Dropdown.Trigger>
                      <Button>
                        <span>Export</span>
                        <Icon>
                          <FontAwesomeIcon icon="angle-down"/>
                        </Icon>
                      </Button>
                    </Dropdown.Trigger>
                    <Dropdown.Menu>
                      <Dropdown.Content>
                        <Dropdown.Item
                          onClick={this.download.bind(this, 'csv')}
                        >
                          <Icon>
                            <FontAwesomeIcon icon="file-csv"/>
                          </Icon>
                          <span>Export with CSV</span>
                        </Dropdown.Item>
                        <Dropdown.Item
                          onClick={this.download.bind(this, 'json')}
                        >
                          <Icon>
                            <FontAwesomeIcon icon="file"/>
                          </Icon>
                          <span>Export with JSON</span>
                        </Dropdown.Item>
                      </Dropdown.Content>
                    </Dropdown.Menu>
                  </Dropdown>
                </Level.Item>
                <Level.Item>
                  <Button
                    onClick={this.remove.bind(this)}
                  >
                    <Icon>
                      <FontAwesomeIcon icon="trash"/>
                    </Icon>
                    <span>Delete</span>
                  </Button>
                </Level.Item>
              </Level.Item>
            </Level>

            <form onSubmit={this.update.bind(this)}>
              <Column.Group>
                <Column size={6}>
                  <Field horizontal>
                    <Field.Label size="normal">
                      <Label>Collection</Label>
                    </Field.Label>
                    <Field.Body>
                      <Field>
                        <Control>
                          <Input
                            static
                            key={this.key('collection')}
                            type="text"
                            name="collection"
                            defaultValue={data.collection}
                          />
                        </Control>
                      </Field>
                    </Field.Body>
                  </Field>

                  <Field horizontal>
                    <Field.Label size="normal">
                      <Label>Key</Label>
                    </Field.Label>
                    <Field.Body>
                      <Field>
                        <Control>
                          <Input
                            static
                            key={this.key('key')}
                            type="text"
                            name="key"
                            defaultValue={data.key}
                          />
                        </Control>
                      </Field>
                    </Field.Body>
                  </Field>

                  <Field horizontal>
                    <Field.Label size="normal">
                      <Label>User ID</Label>
                    </Field.Label>
                    <Field.Body>
                      <Field>
                        <Control>
                          <Input
                            static
                            key={this.key('user_id')}
                            type="text"
                            name="user_id"
                            defaultValue={data.user_id}
                          />
                        </Control>
                      </Field>
                    </Field.Body>
                  </Field>

                  <Field horizontal>
                    <Field.Label size="normal">
                      <Label>Version</Label>
                    </Field.Label>
                    <Field.Body>
                      <Field>
                        <Control>
                          <Input
                            static
                            key={this.key('version')}
                            type="text"
                            name="version"
                            defaultValue={data.version}
                          />
                        </Control>
                      </Field>
                    </Field.Body>
                  </Field>

                  <Field horizontal>
                    <Field.Label size="normal">
                      <Label>Read Permission</Label>
                    </Field.Label>
                    <Field.Body>
                      <Field>
                        <Control>
                          <Select.Container>
                            <Select
                              key={this.key('permission_read')}
                              name="permission_read"
                              defaultValue={data.permission_read}
                            >
                              <Select.Option value="0">No Read (0)</Select.Option>
                              <Select.Option value="1">Private Read (1)</Select.Option>
                              <Select.Option value="2">Public Read (2)</Select.Option>
                            </Select>
                          </Select.Container>
                        </Control>
                      </Field>
                    </Field.Body>
                  </Field>

                  <Field horizontal>
                    <Field.Label size="normal">
                      <Label>Write Permission</Label>
                    </Field.Label>
                    <Field.Body>
                      <Field>
                        <Control>
                          <Select.Container>
                            <Select
                              key={this.key('permission_write')}
                              name="permission_write"
                              defaultValue={data.permission_write}
                            >
                              <Select.Option value="0">No Write (0)</Select.Option>
                              <Select.Option value="1">Private Write (1)</Select.Option>
                            </Select>
                          </Select.Container>
                        </Control>
                      </Field>
                    </Field.Body>
                  </Field>
                </Column>
              </Column.Group>

              <Column.Group>
                <Column>
                  <Field>
                    <Label>Value</Label>
                    <Field>
                      <Control>
                        {
                          data.value ?
                            <Textarea
                              key={this.key('value')}
                              placeholder="Value"
                              rows={8}
                              name="value"
                              defaultValue={data.value}
                            /> :
                            null
                        }
                      </Control>
                    </Field>
                  </Field>
                </Column>
              </Column.Group>

              <Column.Group>
                <Column size={6}>
                  <Field horizontal>
                    <Field.Label size="normal">
                      <Label>Create Time</Label>
                    </Field.Label>
                    <Field.Body>
                      <Field>
                        <Control>
                          <Input
                            static
                            key={this.key('create_time')}
                            type="text"
                            name="create_time"
                            defaultValue={data.create_time}
                          />
                        </Control>
                      </Field>
                    </Field.Body>
                  </Field>

                  <Field horizontal>
                    <Field.Label size="normal">
                      <Label>Update Time</Label>
                    </Field.Label>
                    <Field.Body>
                      <Field>
                        <Control>
                          <Input
                            static
                            key={this.key('update_time')}
                            type="text"
                            name="update_time"
                            defaultValue={data.update_time}
                          />
                        </Control>
                      </Field>
                    </Field.Body>
                  </Field>
                </Column>
              </Column.Group>

              <Field kind="group" align="right">
                {
                  updated ?
                    <Notification color="success">Successfully updated storage record.</Notification> :
                    null
                }
                {
                  errors ?
                    <Notification color="danger">{errors}</Notification> :
                    null
                }
                &nbsp;
                <Control>
                  <Button color="info">Update</Button>
                </Control>
              </Field>
            </form>
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

const mapStateToProps = ({storage_details}: ApplicationState) => ({
  loading: storage_details.loading,
  errors: storage_details.errors,
  updated: storage_details.updated,
  data: storage_details.data
});

const mapDispatchToProps = (dispatch: Dispatch) => ({
  fetchRequest: (data: StorageObjectRequest) => dispatch(
    storageActions.storageFetchRequest(data)
  ),
  updateRequest: (data: StorageObject) => dispatch(
    storageActions.storageUpdateRequest(data)
  ),
  deleteRequest: (data: StorageObjectRequest) => dispatch(
    storageActions.storageDeleteRequest(data)
  )
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(StorageDetails);
