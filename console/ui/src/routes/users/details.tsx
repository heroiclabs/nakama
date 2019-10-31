import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';
import {Link} from 'react-router-dom';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as userActions from '../../store/users/actions';
import {
  ExportObject,
  FriendObject,
  UserGroupObject,
  LedgerObject,
  LedgerObjectRequest,
  UserObject,
  UserObjectRequest
} from '../../store/users/types';

import {
  Breadcrumb,
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
  Section,
  Tab,
  Table,
  Tag,
  Textarea
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

interface UsersDetails {
  [key: string]: any;
}

interface PropsFromState {
  loading: boolean,
  errors: string | undefined,
  updated: boolean,
  data: ExportObject,
  account: ExportObject,
  friends: FriendObject[],
  groups: UserGroupObject[],
  ledgers: LedgerObject[]
}

interface PropsFromDispatch {
  fetchRequest: typeof userActions.userFetchRequest,
  updateRequest: typeof userActions.userUpdateRequest,
  deleteRequest: typeof userActions.userDeleteRequest,
  exportRequest: typeof userActions.userExportRequest,

  fetchFriendRequest: typeof userActions.userFetchFriendRequest,
  fetchGroupRequest: typeof userActions.userFetchGroupRequest,
  fetchLedgerRequest: typeof userActions.userFetchLedgerRequest,

  banRequest: typeof userActions.userBanRequest,
  unbanRequest: typeof userActions.userUnbanRequest,

  unlinkSteamRequest: typeof userActions.userUnlinkSteamRequest,
  unlinkGoogleRequest: typeof userActions.userUnlinkGoogleRequest,
  unlinkGameCenterRequest: typeof userActions.userUnlinkGameCenterRequest,
  unlinkFacebookRequest: typeof userActions.userUnlinkFacebookRequest,
  unlinkEmailRequest: typeof userActions.userUnlinkEmailRequest,
  unlinkDeviceRequest: typeof userActions.userUnlinkDeviceRequest,
  unlinkCustomRequest: typeof userActions.userUnlinkCustomRequest,

  deleteFriendRequest: typeof userActions.userDeleteFriendRequest,
  deleteGroupRequest: typeof userActions.userDeleteGroupRequest,
  deleteLedgerRequest: typeof userActions.userDeleteLedgerRequest
}

type Props = RouteComponentProps & PropsFromState & PropsFromDispatch & ConnectedReduxProps;

type State = {
  tab: string
};

class UsersDetails extends Component<Props, State> {
  public constructor(props: Props) {
    super(props);
    this.state = {tab: 'profile'};
  }

  public componentWillReceiveProps(next: Props) {
    if (
      this.props.data.account.user.id !== next.data.account.user.id &&
      next.data.account.user.id
    ) {
      this.download(next.data);
    }
  }

  public componentDidMount() {
    const {match, history} = this.props;
    if (Object.values(match.params)[0] === '00000000-0000-0000-0000-000000000000') {
      history.push('/users');
    } else {
      this.props.fetchRequest(match.params);
      this.props.fetchFriendRequest(match.params);
      this.props.fetchGroupRequest(match.params);
      this.props.fetchLedgerRequest(match.params);
    }
  }

  public key(prefix: string) {
    const {account} = this.props;
    return `${prefix}_${account.account.user.id}_${account.account.user.update_time}`;
  }

  public unban() {
    const {match} = this.props;
    if (confirm('Are you sure you want to unban this user?')) {
      this.props.unbanRequest(match.params);
    }
  }

  public ban() {
    const {match} = this.props;
    if (confirm('Are you sure you want to ban this user?')) {
      this.props.banRequest(match.params);
    }
  }

  public remove(recorded: boolean) {
    const {match, history} = this.props;
    if (confirm('Are you sure you want to delete this user?')) {
      this.props.deleteRequest(Object.assign({recorded}, match.params));
      history.goBack();
    }
  }

  public download(data: ExportObject) {
    const element = document.createElement('a');
    const file = new Blob(
      [JSON.stringify([data], null, 2)],
      {type: 'application/json'}
    );
    element.href = URL.createObjectURL(file);
    element.download = 'export.json';
    document.body.appendChild(element);
    element.click();
  }

  public go_to_friend(id: string) {
    const {history} = this.props;
    history.push(`/users/${id}`);
  }

  public switch_tab(tab: string) {
    const {match} = this.props;
    if (tab === 'storage') {
      const {history} = this.props;
      history.push(`/storage?user_id=${Object.values(match.params)[0]}`);
    } else {
      this.setState({tab});
    }
  }

  public update_profile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    const payload = {
      id: data.get('id') as string,
      username: data.get('username') as string,
      display_name: data.get('display_name') as string,
      metadata: data.get('metadata') as string,
      create_time: data.get('create_time') as string,
      update_time: data.get('update_time') as string,
      facebook_id: data.get('facebook_id') as string,
      gamecenter_id: data.get('gamecenter_id') as string,
      google_id: data.get('google_id') as string,
      steam_id: data.get('steam_id') as string,
      avatar_url: data.get('avatar_url') as string,
      lang_tag: data.get('lang_tag') as string,
      location: data.get('location') as string,
      timezone: data.get('timezone') as string
    };
    this.props.updateRequest(payload);
  }

  public update_account(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const {match} = this.props;
    const data = new FormData(event.target as HTMLFormElement);
    const password = data.get('password') as string;
    const payload = {
      id: '',
      custom_id: data.get('custom_id') as string,
      devices: data.get('devices') as string,
      email: data.get('email') as string,
      password: password === "" ? null : password,
      verify_time: data.get('verify_time') as string,
      wallet: data.get('wallet') as string,
    };
    this.props.updateRequest(Object.assign(payload, match.params));
  }

  public remove_friend(id: string) {
    const {match} = this.props;
    if (confirm('Are you sure you want to delete this friend?')) {
      this.props.deleteFriendRequest({id});
      this.props.fetchFriendRequest(match.params);
    }
  }

  public remove_group(id: string) {
    const {match} = this.props;
    if (confirm('Are you sure you want to delete this group?')) {
      this.props.deleteGroupRequest({id});
      this.props.fetchGroupRequest(match.params);
    }
  }

  public remove_ledger(id: string) {
    const {match} = this.props;
    if (confirm('Are you sure you want to delete this ledger entry?')) {
      this.props.deleteLedgerRequest(Object.assign({walletId: id}, match.params));
    }
  }

  public unlink(type: string, id: string, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const {match} = this.props;
    if (confirm('Are you sure you want to unlink this user?')) {
      switch (type) {
        case 'steam':
          this.props.unlinkSteamRequest(match.params);
          break;

        case 'google':
          this.props.unlinkGoogleRequest(match.params);
          break;

        case 'gamecenter':
          this.props.unlinkGameCenterRequest(match.params);
          break;

        case 'facebook':
          this.props.unlinkFacebookRequest(match.params);
          break;

        case 'email':
          this.props.unlinkEmailRequest(match.params);
          break;

        case 'device':
          this.props.unlinkDeviceRequest({id: ((match.params as Record<string, string>)["id"] as string), device_id: id});
          break;

        case 'custom':
          this.props.unlinkCustomRequest(match.params);
          break;
      }
    }
  }

  public render_profile(id: string) {
    const {account, updated, errors} = this.props;
    return <form onSubmit={this.update_profile.bind(this)}>
      <Column.Group>
        <Column size={6}>
          <Field horizontal>
            <Field.Label size="normal">
              <Label>ID</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    key={this.key('id')}
                    static
                    type="text"
                    name="id"
                    defaultValue={account.account.user.id}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Username</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    key={this.key('username')}
                    type="text"
                    placeholder="(empty)"
                    name="username"
                    maxLength="128"
                    defaultValue={account.account.user.username}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Display Name</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    key={this.key('display_name')}
                    type="text"
                    placeholder="(empty)"
                    name="display_name"
                    maxLength="255"
                    defaultValue={account.account.user.display_name}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Metadata</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Textarea
                    key={this.key('metadata')}
                    placeholder="Metadata"
                    rows={6}
                    name="metadata"
                    defaultValue={account.account.user.metadata}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

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
                    defaultValue={account.account.user.create_time}
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
                    defaultValue={account.account.user.update_time}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>
        </Column>

        <Column size={6}>
          <Field horizontal>
            <Field.Label size="normal">
              <Label>Facebook ID</Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled
                    key={this.key('facebook_id')}
                    type="text"
                    placeholder="(empty)"
                    name="facebook_id"
                    maxLength="128"
                    defaultValue={account.account.user.facebook_id}
                  />
                </Control>
                <Control>
                  <Button
                    disabled={!account.account.user.facebook_id}
                    onClick={this.unlink.bind(this, 'facebook', "")}
                  >Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Game Center ID</Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled
                    key={this.key('gamecenter_id')}
                    type="text"
                    placeholder="(empty)"
                    name="gamecenter_id"
                    maxLength="128"
                    defaultValue={account.account.user.gamecenter_id}
                  />
                </Control>
                <Control>
                  <Button
                    disabled={!account.account.user.gamecenter_id}
                    onClick={this.unlink.bind(this, 'gamecenter', "")}
                  >Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Google ID</Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled
                    key={this.key('google_id')}
                    type="text"
                    placeholder="(empty)"
                    name="google_id"
                    maxLength="128"
                    defaultValue={account.account.user.google_id}
                  />
                </Control>
                <Control>
                  <Button
                    disabled={!account.account.user.google_id}
                    onClick={this.unlink.bind(this, 'google', "")}
                  >Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Steam ID</Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled
                    key={this.key('steam_id')}
                    type="text"
                    placeholder="(empty)"
                    name="steam_id"
                    maxLength="128"
                    defaultValue={account.account.user.steam_id}
                  />
                </Control>
                <Control>
                  <Button
                    disabled={!account.account.user.steam_id}
                    onClick={this.unlink.bind(this, 'steam', "")}
                  >Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Avatar URL</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    key={this.key('avatar_url')}
                    type="text"
                    placeholder="(empty)"
                    name="avatar_url"
                    maxLength="512"
                    defaultValue={account.account.user.avatar_url}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Lang Tag</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    key={this.key('lang_tag')}
                    type="text"
                    placeholder="(empty)"
                    name="lang_tag"
                    maxLength="18"
                    defaultValue={account.account.user.lang_tag}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Location</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    key={this.key('location')}
                    type="text"
                    placeholder="(empty)"
                    name="location"
                    maxLength="255"
                    defaultValue={account.account.user.location}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Timezone</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    key={this.key('timezone')}
                    type="text"
                    placeholder="(empty)"
                    name="timezone"
                    maxLength="255"
                    defaultValue={account.account.user.timezone}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field kind="group" align="right">
            {
              updated ?
                <Notification color="success">Successfully updated user profile record.</Notification> :
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
        </Column>
      </Column.Group>
    </form>;
  }

  public render_account(id: string) {
    const {account, updated, errors} = this.props;
    return <form onSubmit={this.update_account.bind(this)}>
      <Column.Group>
        <Column size={6}>
          <Field horizontal>
            <Field.Label size="normal">
              <Label>Custom ID</Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled
                    key={this.key('custom_id')}
                    type="text"
                    placeholder="(empty)"
                    name="custom_id"
                    maxLength="128"
                    defaultValue={account.account.custom_id}
                  />
                </Control>
                <Control>
                  <Button
                    disabled={!account.account.custom_id}
                    onClick={this.unlink.bind(this, 'custom', "")}
                  >Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>

          {
            (account.account.devices || []).map((d, key) =>
              <Field horizontal key={this.key(`device_${key}`)}>
                <Field.Label size="normal">
                  <Label>{key ? '' : 'Device ID'}</Label>
                </Field.Label>
                <Field.Body>
                  <Field kind="addons">
                    <Control expanded>
                      <Input
                        disabled
                        key={this.key(`device_${key}_${id}`)}
                        type="text"
                        name="devices[]"
                        defaultValue={d.id}
                      />
                    </Control>
                    <Control>
                      <Button
                        disabled={!d.id}
                        onClick={this.unlink.bind(this, 'device', d.id)}
                      >Unlink</Button>
                    </Control>
                  </Field>
                </Field.Body>
              </Field>
            )
          }

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Email</Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled
                    key={this.key('email')}
                    type="text"
                    placeholder="(empty)"
                    name="email"
                    maxLength="255"
                    defaultValue={account.account.email}
                  />
                </Control>
                <Control>
                  <Button
                    disabled={!account.account.email}
                    onClick={this.unlink.bind(this, 'email', "")}
                  >Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Password</Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled={!account.account.email}
                    key={this.key('password')}
                    type="text"
                    placeholder="(new password)"
                    name="password"
                    maxLength="255"
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Verified</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    static
                    key={this.key('verified')}
                    type="text"
                    name="verified"
                    defaultValue={account.account.verify_time || 'false'}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field horizontal>
            <Field.Label size="normal">
              <Label>Wallet</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Textarea
                    key={this.key('wallet')}
                    placeholder="Wallet"
                    rows="6"
                    name="wallet"
                    defaultValue={account.account.wallet}
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>

          <Field kind="group" align="right">
            {
              updated ?
                <Notification color="success">Successfully updated user profile record.</Notification> :
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
        </Column>
      </Column.Group>
    </form>;
  }

  public render_friends(id: string) {
    const {friends} = this.props;
    return <Table key={this.key(`friends_${id}`)} fullwidth striped hoverable>
      <Table.Head>
        <Table.Row>
          <Table.Heading style={{width: '35%'}}>User ID</Table.Heading>
          <Table.Heading style={{width: '17.5%'}}>Username</Table.Heading>
          <Table.Heading style={{width: '17.5%'}}>State</Table.Heading>
          <Table.Heading style={{width: '20%'}}>Update Time</Table.Heading>
          <Table.Heading style={{width: '10%'}}>&nbsp;</Table.Heading>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {
          (friends || []).map((f, key) =>
            <Table.Row
              key={this.key(`friends_${id}_${key}`)}
              onClick={this.go_to_friend.bind(this, f.user.id)}
            >
              <Table.Cell>{f.user.id}</Table.Cell>
              <Table.Cell>{f.user.username}</Table.Cell>
              <Table.Cell>{f.state}</Table.Cell>
              <Table.Cell>{f.user.update_time}</Table.Cell>
              <Table.Cell>
                <Button
                  size="small"
                  onClick={this.remove_friend.bind(this, f.user.id)}
                >Delete</Button>
              </Table.Cell>
            </Table.Row>
          )
        }
      </Table.Body>
    </Table>;
  }

  public render_groups(id: string) {
    const {groups} = this.props;
    return <Table key={this.key(`groups_${id}`)} fullwidth striped>
      <Table.Head>
        <Table.Row>
          <Table.Heading style={{width: '35%'}}>Group ID</Table.Heading>
          <Table.Heading style={{width: '20%'}}>Name</Table.Heading>
          <Table.Heading style={{width: '10%'}}>State</Table.Heading>
          <Table.Heading style={{width: '25%'}}>Update Time</Table.Heading>
          <Table.Heading style={{width: '10%'}}>&nbsp;</Table.Heading>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {
          (groups || []).map((g, key) =>
            <Table.Row key={this.key(`groups_${id}_${key}`)}>
              <Table.Cell>{g.group.id}</Table.Cell>
              <Table.Cell>{g.group.name}</Table.Cell>
              <Table.Cell>{g.state}</Table.Cell>
              <Table.Cell>{g.group.update_time}</Table.Cell>
              <Table.Cell>
                <Button
                  size="small"
                  onClick={this.remove_group.bind(this, g.group.id)}
                >Delete</Button>
              </Table.Cell>
            </Table.Row>
          )
        }
      </Table.Body>
    </Table>;
  }

  public render_wallet(id: string) {
    const {ledgers} = this.props;
    return <Table key={this.key(`wallet_${id}`)} fullwidth striped>
      <Table.Head>
        <Table.Row>
          <Table.Heading style={{width: '35%'}}>ID</Table.Heading>
          <Table.Heading style={{width: '15%'}}>Changeset</Table.Heading>
          <Table.Heading style={{width: '15%'}}>Metadata</Table.Heading>
          <Table.Heading style={{width: '25%'}}>Update Time</Table.Heading>
          <Table.Heading style={{width: '10%'}}>&nbsp;</Table.Heading>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {
          (ledgers || []).map((l, key) =>
            <Table.Row key={this.key(`wallet_${id}_${key}`)}>
              <Table.Cell>{l.id}</Table.Cell>
              <Table.Cell>{l.changeset}</Table.Cell>
              <Table.Cell>{l.metadata}</Table.Cell>
              <Table.Cell>{l.update_time}</Table.Cell>
              <Table.Cell>
                <Button
                  size="small"
                  onClick={this.remove_ledger.bind(this, l.id)}
                >Delete</Button>
              </Table.Cell>
            </Table.Row>
          )
        }
      </Table.Body>
    </Table>;
  }

  public render() {
    const {account, friends, match, exportRequest} = this.props;
    const {tab} = this.state;
    return <Generic id="users_details">
      <Header/>
      <Section>
        <Column.Group>
          <Sidebar active="users"/>

          <Column>
            <Level>
              <Level.Item align="left">
                <Level.Item>
                  <Breadcrumb>
                    <Breadcrumb.Item as="span"><Link to="/users">Users</Link></Breadcrumb.Item>
                    <Breadcrumb.Item active>{account.account.user.id}</Breadcrumb.Item>
                  </Breadcrumb>
                </Level.Item>
              </Level.Item>
              <Level.Item align="right">
                <Level.Item>
                  <Button onClick={exportRequest.bind(this, match.params)}>
                    <Icon>
                      <FontAwesomeIcon icon="file-export"/>
                    </Icon>
                    <span>Export</span>
                  </Button>
                </Level.Item>
                {
                  account.disable_time ?
                    <Level.Item>
                      <Button onClick={this.unban.bind(this)}>
                        <Icon>
                          <FontAwesomeIcon icon="ban"/>
                        </Icon>
                        <span>Unban</span>
                      </Button>
                    </Level.Item> :
                    <Level.Item>
                      <Button onClick={this.ban.bind(this)}>
                        <Icon>
                          <FontAwesomeIcon icon="ban"/>
                        </Icon>
                        <span>Ban</span>
                      </Button>
                    </Level.Item>
                }
                <Level.Item>
                  <Button onClick={this.remove.bind(this, false)}>
                    <Icon>
                      <FontAwesomeIcon icon="trash"/>
                    </Icon>
                    <span>Delete</span>
                  </Button>
                </Level.Item>
                <Level.Item>
                  <Button onClick={this.remove.bind(this, true)}>
                    <Icon>
                      <FontAwesomeIcon icon="trash"/>
                    </Icon>
                    <span>Recorded Delete</span>
                  </Button>
                </Level.Item>
              </Level.Item>
            </Level>

            <Tab.Group>
              <Tab
                active={tab === 'profile'}
                onClick={this.switch_tab.bind(this, 'profile')}
              >Profile</Tab>
              <Tab
                active={tab === 'account'}
                onClick={this.switch_tab.bind(this, 'account')}
              >Account</Tab>
              <Tab
                active={tab === 'friends'}
                onClick={this.switch_tab.bind(this, 'friends')}
              >Friends &nbsp;<Tag>{friends.length}</Tag></Tab>
              <Tab
                active={tab === 'groups'}
                onClick={this.switch_tab.bind(this, 'groups')}
              >Groups</Tab>
              <Tab
                active={tab === 'wallet'}
                onClick={this.switch_tab.bind(this, 'wallet')}
              >Wallet</Tab>
              <Tab
                onClick={this.switch_tab.bind(this, 'storage')}
              >
                <span>Storage</span>
                <Icon size="small">
                  <FontAwesomeIcon icon="link"/>
                </Icon>
              </Tab>
            </Tab.Group>

            {this[`render_${tab}`](account.account.user.id)}
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

const mapStateToProps = ({user_details}: ApplicationState) => ({
  loading: user_details.loading,
  errors: user_details.errors,
  updated: user_details.updated,
  data: user_details.data,
  account: user_details.account,
  friends: user_details.friends,
  groups: user_details.groups,
  ledgers: user_details.ledgers
});

const mapDispatchToProps = (dispatch: Dispatch) => ({
  fetchRequest: (data: UserObjectRequest) => dispatch(
    userActions.userFetchRequest(data)
  ),
  updateRequest: (data: UserObject) => dispatch(
    userActions.userUpdateRequest(data)
  ),
  deleteRequest: (data: UserObjectRequest) => dispatch(
    userActions.userDeleteRequest(data)
  ),
  exportRequest: (data: UserObjectRequest) => dispatch(
    userActions.userExportRequest(data)
  ),

  fetchFriendRequest: (data: UserObjectRequest) => dispatch(
    userActions.userFetchFriendRequest(data)
  ),
  fetchGroupRequest: (data: UserObjectRequest) => dispatch(
    userActions.userFetchGroupRequest(data)
  ),
  fetchLedgerRequest: (data: UserObjectRequest) => dispatch(
    userActions.userFetchLedgerRequest(data)
  ),

  banRequest: (data: UserObjectRequest) => dispatch(
    userActions.userBanRequest(data)
  ),
  unbanRequest: (data: UserObjectRequest) => dispatch(
    userActions.userUnbanRequest(data)
  ),

  unlinkSteamRequest: (data: UserObjectRequest) => dispatch(
    userActions.userUnlinkSteamRequest(data)
  ),
  unlinkGoogleRequest: (data: UserObjectRequest) => dispatch(
    userActions.userUnlinkGoogleRequest(data)
  ),
  unlinkGameCenterRequest: (data: UserObjectRequest) => dispatch(
    userActions.userUnlinkGameCenterRequest(data)
  ),
  unlinkFacebookRequest: (data: UserObjectRequest) => dispatch(
    userActions.userUnlinkFacebookRequest(data)
  ),
  unlinkEmailRequest: (data: UserObjectRequest) => dispatch(
    userActions.userUnlinkEmailRequest(data)
  ),
  unlinkDeviceRequest: (data: UserObjectRequest) => dispatch(
    userActions.userUnlinkDeviceRequest(data)
  ),
  unlinkCustomRequest: (data: UserObjectRequest) => dispatch(
    userActions.userUnlinkCustomRequest(data)
  ),

  deleteFriendRequest: (data: UserObjectRequest) => dispatch(
    userActions.userDeleteFriendRequest(data)
  ),
  deleteGroupRequest: (data: UserObjectRequest) => dispatch(
    userActions.userDeleteGroupRequest(data)
  ),
  deleteLedgerRequest: (data: LedgerObjectRequest) => dispatch(
    userActions.userDeleteLedgerRequest(data)
  )
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(UsersDetails);
