import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';
import queryString from 'query-string';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as userActions from '../../store/users/actions';
import {UserObject, UserObjectRequest, UsersObject, UsersObjectRequest} from '../../store/users/types';

import {Button, Column, Control, Field, Generic, Icon, Input, Level, Section, Table, Title} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

interface PropsFromState {
  loading: boolean,
  errors: string | undefined,
  data: UsersObject
}

interface PropsFromDispatch {
  fetchManyRequest: typeof userActions.userFetchManyRequest,
  deleteManyRequest: typeof userActions.userDeleteManyRequest,
  deleteRequest: typeof userActions.userDeleteRequest
}

type Props = RouteComponentProps & PropsFromState & PropsFromDispatch & ConnectedReduxProps;

type State = {
  filter: string,
  banned: boolean,
  tombstones: boolean
};

class Users extends Component<Props, State> {
  public constructor(props: Props) {
    super(props);
    this.state = {filter: '', banned: false, tombstones: false};
  }

  public componentDidMount() {
    const query = queryString.parse(this.props.location.search);
    if (query.filter) {
      (document.getElementById('filter') as HTMLInputElement).value = query.filter as string;
    }
    this.setState({
      filter: query.filter as string || '',
      banned: !!query.banned,
      tombstones: !!query.tombstones
    });
    this.props.fetchManyRequest({
      filter: query.filter as string || '',
      banned: !!query.banned,
      tombstones: !!query.tombstones
    });
  }

  public all() {
    this.setState({
      banned: false,
      tombstones: false
    });
    this.props.fetchManyRequest({
      filter: this.state.filter,
      banned: false,
      tombstones: false
    });
  }

  public banned() {
    this.setState({
      banned: true,
      tombstones: false
    });
    this.props.fetchManyRequest({
      filter: this.state.filter,
      banned: true,
      tombstones: false
    });
  }

  public tombstones() {
    this.setState({
      banned: false,
      tombstones: true
    });
    this.props.fetchManyRequest({
      filter: this.state.filter,
      banned: false,
      tombstones: true
    });
  }

  public filter() {
    const {history} = this.props;
    const filter = (document.getElementById('filter') as HTMLInputElement).value;
    history.push(`/users?filter=${filter}`);
    this.setState({filter});
    this.props.fetchManyRequest({filter});
  }

  public details(id: string) {
    const {history} = this.props;
    history.push(`/users/${id}`);
  }

  public remove_all() {
    if (confirm('Are you sure you want to delete all users?')) {
      this.props.deleteManyRequest(this.state);
    }
  }

  public remove(object: UserObject, event: React.FormEvent<Element>) {
    event.stopPropagation();
    event.preventDefault();
    if (confirm('Are you sure you want to delete this user?')) {
      this.props.deleteRequest(Object.assign(object, this.state));
    }
  }

  public render() {
    const {banned, tombstones} = this.state;
    const {data} = this.props;
    return <Generic id="users">
      <Header/>
      <Section>
        <Column.Group>
          <Sidebar active="users"/>

          <Column>
            <Level>
              <Level.Item align="left">
                <Level.Item>
                  <Title subtitle size={5}>
                    ~<strong>{data.total_count}</strong> users
                  </Title>
                </Level.Item>

                <Level.Item>
                  <Field kind="addons">
                    <Control>
                      <Input id="filter" type="text" placeholder="Find a user"/>
                    </Control>
                    <Control>
                      <Button onClick={this.filter.bind(this)}>Lookup</Button>
                    </Control>
                  </Field>
                </Level.Item>

                <Level.Item>{
                  (!banned && !tombstones) ?
                    <strong>All</strong> :
                    <a onClick={this.all.bind(this)}>All</a>
                }</Level.Item>
                <Level.Item>{
                  banned ?
                    <strong>Banned</strong> :
                    <a onClick={this.banned.bind(this)}>Banned</a>
                }</Level.Item>
                <Level.Item>{
                  tombstones ?
                    <strong>Tombstones</strong> :
                    <a onClick={this.tombstones.bind(this)}>Tombstones</a>
                }</Level.Item>
              </Level.Item>

              <Level.Item align="right">
                <Level.Item>
                  <Button onClick={this.remove_all.bind(this)}>
                    <Icon>
                      <FontAwesomeIcon icon="trash"/>
                    </Icon>
                    <span>Delete All</span>
                  </Button>
                </Level.Item>
              </Level.Item>
            </Level>

            <Table fullwidth striped hoverable>
              <Table.Head>
                <Table.Row>
                  <Table.Heading style={{width: '35%'}}>ID</Table.Heading>
                  <Table.Heading style={{width: '17.5%'}} hidden={tombstones}>Username</Table.Heading>
                  <Table.Heading style={{width: '17.5%'}} hidden={tombstones}>Display Name</Table.Heading>
                  <Table.Heading style={{width: '20%'}}>Update Time</Table.Heading>
                  <Table.Heading style={{width: '10%'}}>&nbsp;</Table.Heading>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {
                  (data.users || []).map((user, key) =>
                    <Table.Row
                      key={`cell_${key}`}
                      onClick={!tombstones ? this.details.bind(this, user.id) : null}
                    >
                      <Table.Cell
                        className={user.id == '00000000-0000-0000-0000-000000000000' || tombstones ? 'nopointer' : ''}>{user.id}</Table.Cell>
                      <Table.Cell hidden={tombstones}>{user.username}</Table.Cell>
                      <Table.Cell hidden={tombstones}>{user.display_name}</Table.Cell>
                      <Table.Cell
                        className={user.id == '00000000-0000-0000-0000-000000000000' || tombstones ? 'nopointer' : ''}>{user.update_time}</Table.Cell>
                      <Table.Cell>
                        {
                          user.id == '00000000-0000-0000-0000-000000000000' || tombstones ?
                            null :
                            <Button
                              size="small"
                              onClick={this.remove.bind(this, user)}
                            >Delete</Button>
                        }
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

const mapStateToProps = ({user}: ApplicationState) => ({
  loading: user.loading,
  errors: user.errors,
  data: user.data
});

const mapDispatchToProps = (dispatch: Dispatch) => ({
  fetchManyRequest: (data: UsersObjectRequest) => dispatch(
    userActions.userFetchManyRequest(data)
  ),
  deleteManyRequest: (data: UserObjectRequest) => dispatch(
    userActions.userDeleteManyRequest(data)
  ),
  deleteRequest: (data: UserObjectRequest) => dispatch(
    userActions.userDeleteRequest(data)
  )
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Users);
