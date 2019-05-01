import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';
import queryString from 'query-string';
import Dropzone from 'react-dropzone';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as storageActions from '../../store/storage/actions';
import {StorageObjectRequest, StorageObject, Storages} from '../../store/storage/types';

import {NakamaApi} from '../../api.gen';

import {
  Box,
  Button,
  Column,
  Control,
  Delete,
  Dropdown,
  Field,
  Generic,
  Icon,
  Input,
  Level,
  Notification,
  Section,
  Table,
  Title
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 * https://react-dropzone.js.org
 */

interface PropsFromState
{
  loading: boolean,
  errors: string|undefined,
  data: Storages
}

interface PropsFromDispatch
{
  fetchManyRequest: typeof storageActions.storageFetchManyRequest,
  deleteManyRequest: typeof storageActions.storageDeleteManyRequest,
  deleteRequest: typeof storageActions.storageDeleteRequest
}

type Props = RouteComponentProps & PropsFromState & PropsFromDispatch & ConnectedReduxProps;

type State = {
  format: null|string,
  uploaded: boolean,
  failed: boolean
};

class Storage extends Component<Props, State>
{
  public constructor(props: Props)
  {
    super(props);
    this.state = {format: null, uploaded: false, failed: false};
  }

  public componentDidMount()
  {
    const query = queryString.parse(this.props.location.search);
    if(query.user_id)
    {
      (document.getElementById('user_id') as HTMLInputElement).value = query.user_id as string;
    }
    this.props.fetchManyRequest(query);
  }

  public filter(user_id: string)
  {
    const {history, fetchManyRequest} = this.props;
    if(user_id)
    {
      (document.getElementById('user_id') as HTMLInputElement).value = user_id;
    }
    else
    {
      user_id = (document.getElementById('user_id') as HTMLInputElement).value;
    }
    history.push(`/storage?user_id=${user_id}`);
    fetchManyRequest({user_id});
  }

  public upload(format: null|string, event: React.FormEvent<Element>)
  {
    event.stopPropagation();
    event.preventDefault();
    this.setState({format, uploaded: false, failed: false});
  }

  public files(files: any[])
  {
    const {format} = this.state;
    const body = new FormData();

    files.forEach((file, i) => body.append(
      `import_${i}.${format}`,
      file,
      `import_${i}.${format}`
    ));

    try
    {
      window.nakama_api.doFetch(
        '/v2/console/storage/import',
        'POST',
        {},
        body,
        {
          headers:
          {
            'Content-Type': null
          }
        }
      ).then(
        (() =>
        {
          this.setState({uploaded: true, failed: false});
        }).bind(this)
      ).catch(
        ((err: any) =>
        {
          console.error(err);
          this.setState({uploaded: false, failed: true});
        }).bind(this)
      );
    }
    catch(err)
    {
      console.error(err);
      this.setState({uploaded: false, failed: true});
    }
  }

  public details(object: StorageObject)
  {
    const {history} = this.props;
    history.push(`/storage/${object.collection}/${object.key}/${object.user_id}`);
  }

  public remove_all()
  {
    if(confirm('Are you sure you want to delete all objects?'))
    {
      this.props.deleteManyRequest();
      (document.getElementById('user_id') as HTMLInputElement).value = '';
    }
  }

  public remove(object: StorageObject, event: React.FormEvent<Element>)
  {
    event.stopPropagation();
    event.preventDefault();
    if(confirm('Are you sure you want to delete this object?'))
    {
      var user_id = (document.getElementById('user_id') as HTMLInputElement).value;

      var request = {
        filter: user_id,
        user_id: object.user_id,
        collection: object.collection,
        key: object.key
      } as StorageObjectRequest;

      this.props.deleteRequest(request);
    }
  }

  public render()
  {
    const {data} = this.props;
    const {format, uploaded, failed} = this.state;
    return <Generic id="storage">
      <Header />
      <Section>
        <Column.Group>
          <Sidebar active="storage" />

          <Column>
            <Level>
              <Level.Item align="left">
                <Level.Item>
                  <Title subtitle size={5}>
                    ~<strong>{data.total_count || 0}</strong> objects
                  </Title>
                </Level.Item>

                <Level.Item>
                  <Button
                    title="Select system-owned objects."
                    onClick={this.filter.bind(this, '00000000-0000-0000-0000-000000000000')}
                  >
                    <Icon>
                      <FontAwesomeIcon icon="users-cog" />
                    </Icon>
                  </Button>
                </Level.Item>

                <Level.Item>
                  <Field kind="addons">
                    <Control expanded>
                      <Input id="user_id" type="text" placeholder="Find objects for user" />
                    </Control>
                    <Control>
                      <Button
                        onClick={this.filter.bind(this, '')}
                      >Lookup</Button>
                    </Control>
                  </Field>
                </Level.Item>
              </Level.Item>

              <Level.Item align="right">
                <Level.Item>
                  <Dropdown hoverable>
                    <Dropdown.Trigger>
                      <Button>
                        <span>Import</span>
                        <Icon>
                          <FontAwesomeIcon icon="angle-down" />
                        </Icon>
                      </Button>
                    </Dropdown.Trigger>
                    <Dropdown.Menu>
                      <Dropdown.Content>
                        <Dropdown.Item onClick={this.upload.bind(this, 'csv')}>
                          <Icon>
                            <FontAwesomeIcon icon="file-csv" />
                          </Icon>
                          <span>Import with CSV</span>
                        </Dropdown.Item>
                        <Dropdown.Item onClick={this.upload.bind(this, 'json')}>
                          <Icon>
                            <FontAwesomeIcon icon="file" />
                          </Icon>
                          <span>Import with JSON</span>
                        </Dropdown.Item>
                      </Dropdown.Content>
                    </Dropdown.Menu>
                  </Dropdown>
                </Level.Item>

                <Level.Item>
                  <Button
                    onClick={this.remove_all.bind(this)}
                  >
                    <Icon>
                      <FontAwesomeIcon icon="trash" />
                    </Icon>
                    <span>Delete All</span>
                  </Button>
                </Level.Item>
              </Level.Item>
            </Level>

            {
              format ?
              <Dropzone onDrop={this.files.bind(this)}>
                {({getRootProps, getInputProps}) => (
                  <div {...getRootProps()}>
                    <br />
                    <input {...getInputProps()} />
                    <Box textAlign="centered">
                      <Level>
                        <Level.Item align="left">
                          Drop your {format === 'csv' ? 'CSV' : 'JSON'} file here or click here to select.
                        </Level.Item>
                        <Level.Item align="right">
                          <Delete as="button" onClick={this.upload.bind(this, null)} />
                        </Level.Item>
                      </Level>
                    </Box>
                    <br />
                  </div>
                )}
              </Dropzone> :
              null
            }
            {
              uploaded ?
              <Notification color="success">Successfully uploaded the file.</Notification> :
              null
            }
            {
              failed ?
              <Notification color="danger">Failed to upload the file.</Notification> :
              null
            }

            <Table fullwidth striped hoverable>
              <Table.Head>
                <Table.Row>
                  <Table.Heading style={{width: '17.5%'}}>Collection</Table.Heading>
                  <Table.Heading style={{width: '17.5%'}}>Key</Table.Heading>
                  <Table.Heading style={{width: '35%'}}>User ID</Table.Heading>
                  <Table.Heading style={{width: '20%'}}>Update Time</Table.Heading>
                  <Table.Heading style={{width: '10%'}}>&nbsp;</Table.Heading>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {
                  (data.objects || []).map(object =>
                    <Table.Row key={`${object.collection}_${object.key}_${object.user_id}`} onClick={this.details.bind(this, object)}>
                      <Table.Cell>{object.collection}</Table.Cell>
                      <Table.Cell>{object.key}</Table.Cell>
                      <Table.Cell>{object.user_id}</Table.Cell>
                      <Table.Cell>{object.update_time}</Table.Cell>
                      <Table.Cell>
                        <Button
                          size="small"
                          onClick={this.remove.bind(this, object)}
                        >Delete</Button>
                      </Table.Cell>
                    </Table.Row>
                  )
                }
              </Table.Body>
            </Table>
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

const mapStateToProps = ({storage}: ApplicationState) => ({
  loading: storage.loading,
  errors: storage.errors,
  data: storage.data
});

const mapDispatchToProps = (dispatch: Dispatch) => ({
  fetchManyRequest: (data: StorageObjectRequest) => dispatch(
    storageActions.storageFetchManyRequest(data)
  ),
  deleteManyRequest: () => dispatch(
    storageActions.storageDeleteManyRequest()
  ),
  deleteRequest: (data: StorageObjectRequest) => dispatch(
    storageActions.storageDeleteRequest(data)
  )
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Storage);
