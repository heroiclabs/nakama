import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as userActions from '../../store/users/actions';
import {
  UserObjectRequest,
  UserObject,
  UsersObjectRequest,
  UsersObject
} from '../../store/users/types';

import {
  Button,
  Column,
  Control,
  Field,
  Generic,
  Icon,
  Input,
  Level,
  Section,
  Table,
  Title
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 */

interface PropsFromState
{
  loading: boolean,
  errors: string|undefined,
  data: UsersObject
}

interface PropsFromDispatch
{
  fetchManyRequest: typeof userActions.userFetchManyRequest,
  deleteManyRequest: typeof userActions.userDeleteManyRequest,
  deleteRequest: typeof userActions.userDeleteRequest
}

type Props = RouteComponentProps & PropsFromState & PropsFromDispatch & ConnectedReduxProps;

type State = {
};

class Users extends Component<Props, State>
{
  public componentDidMount()
  {
    // const query = queryString.parse(this.props.location.search);
    // if(query.user_id)
    // {
    //   (document.getElementById('user_id') as HTMLInputElement).value = query.user_id as string;
    // }
    this.props.fetchManyRequest({});
  }
  
  public filter(filter: string)
  {
    const {history, fetchManyRequest} = this.props;
    // if(user_id)
    // {
    //   (document.getElementById('user_id') as HTMLInputElement).value = user_id;
    // }
    // else
    // {
    //   user_id = (document.getElementById('user_id') as HTMLInputElement).value;
    // }
    history.push(`/users?filter=${filter}`);
    fetchManyRequest({filter});
  }
  
  public details(id: string)
  {
    const {history} = this.props;
    history.push(`/users/${id}`);
  }
  
  public remove_all()
  {
    if(confirm('Are you sure you want to delete all objects?'))
    {
      this.props.deleteManyRequest();
      (document.getElementById('user_id') as HTMLInputElement).value = '';
      this.props.fetchManyRequest({});
    }
  }
  
  public remove(object: UserObject, event: React.FormEvent<Element>)
  {
    event.stopPropagation();
    event.preventDefault();
    if(confirm('Are you sure you want to delete this object?'))
    {
      this.props.deleteRequest(object);
      (document.getElementById('user_id') as HTMLInputElement).value = '';
      this.props.fetchManyRequest({});
    }
  }
  
  public render()
  {
    const {data} = this.props;
    return <Generic id="users">
      <Header />
      <Section>
        <Column.Group>
          <Sidebar active="users" />

          <Column>
            <Level>
              <Level.Item align="left">
                <Level.Item>
                  <Title subtitle size={5}>
                    <strong>{data.users.length}</strong> users
                  </Title>
                </Level.Item>
                
                <Level.Item>
                  <Field kind="addons">
                    <Control>
                      <Input type="text" placeholder="Find a user" />
                    </Control>
                    <Control>
                      <Button>Lookup</Button>
                    </Control>
                  </Field>
                </Level.Item>
                
                <Level.Item><strong>All</strong></Level.Item>
                
                <Level.Item><a href="#">Banned</a></Level.Item>
                
                <Level.Item><a href="#">Tombstones</a></Level.Item>
              </Level.Item>

              <Level.Item align="right">
                <Level.Item>
                  <Button>
                    <Icon>
                      <FontAwesomeIcon icon="trash" />
                    </Icon>
                    <span>Delete All</span>
                  </Button>
                </Level.Item>
              </Level.Item>
            </Level>

            <Table fullwidth striped hoverable>
              <Table.Head>
                <Table.Row>
                  <Table.Heading>ID</Table.Heading>
                  <Table.Heading>Username</Table.Heading>
                  <Table.Heading>Display Name</Table.Heading>
                  <Table.Heading>Update Time</Table.Heading>
                  <Table.Heading>&nbsp;</Table.Heading>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {
                  data.users.map((u, key) =>
                    <Table.Row
                      key={`cell_${key}`}
                      onClick={this.details.bind(this, u.id)}
                    >
                      <Table.Cell>{u.id}</Table.Cell>
                      <Table.Cell>{u.username}</Table.Cell>
                      <Table.Cell>{u.display_name}</Table.Cell>
                      <Table.Cell>{u.update_time}</Table.Cell>
                      <Table.Cell>
                        <Button size="small">Delete</Button>
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
  deleteManyRequest: () => dispatch(
    userActions.userDeleteManyRequest()
  ),
  deleteRequest: (data: UserObjectRequest) => dispatch(
    userActions.userDeleteRequest(data)
  )
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Users);
