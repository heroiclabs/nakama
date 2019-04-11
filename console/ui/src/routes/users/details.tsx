import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';
import {Link} from 'react-router-dom';

import {
  Breadcrumb,
  Button,
  Column,
  Control,
  Generic,
  Field,
  Icon,
  Input,
  Label,
  Level,
  Section,
  Tab,
  Table,
  Tag,
  Textarea
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 */

interface UsersDetails
{
  [key:string]: any;
}

type Props = RouteComponentProps;

type State = {
  tab: string;
};

class UsersDetails extends Component<Props, State>
{
  public constructor(props: Props)
  {
    super(props);
    this.state = {tab: 'profile'};
  }
  
  public switch_tab(tab: string)
  {
    if(tab === 'storage')
    {
      const {history} = this.props;
      history.push('/storage');
    }
    else
    {
      this.setState({tab});
    }
  }
  
  public update_profile()
  {
    
  }
  
  public update_account()
  {
    
  }
  
  public remove_friend()
  {
    
  }
  
  public remove_group()
  {
    
  }
  
  public remove_wallet()
  {
    
  }
  
  public render_profile()
  {
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
                    static
                    type="text"
                    name="id"
                    defaultValue="001b0970-3291-4176-b0da-a7743c3036e3"
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
                    type="text"
                    placeholder="(empty)"
                    name="username"
                    defaultValue="JNbhSTvuNj"
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
                    type="text"
                    placeholder="(empty)"
                    name="display_name"
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
                    placeholder="Metadata"
                    rows={6}
                    name="metadata"
                    defaultValue=""
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
                    type="text"
                    name="create_time"
                    defaultValue="2018-08-07 11:29:36.764366+00:00"
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
                    type="text"
                    name="update_time"
                    value="2018-08-07 11:29:36.764366+00:00"
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
                    type="text"
                    name="facebook_id"
                    defaultValue="1810399758992730"
                  />
                </Control>
                <Control>
                  <Button>Unlink</Button>
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
                    type="text"
                    name="game_center_id"
                    defaultValue="G:1026207127"
                  />
                </Control>
                <Control>
                  <Button>Unlink</Button>
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
                    type="text"
                    name="google_id"
                    defaultValue="114522506190423282632"
                  />
                </Control>
                <Control>
                  <Button>Unlink</Button>
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
                    type="text"
                    name="steam_id"
                    defaultValue="steamusername1"
                  />
                </Control>
                <Control>
                  <Button>Unlink</Button>
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
                    type="text"
                    placeholder="(empty)"
                    name="avatar_url"
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
                    type="text"
                    placeholder="(empty)"
                    name="lang_tag"
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
                    type="text"
                    placeholder="(empty)"
                    name="location"
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
                    type="text"
                    placeholder="(empty)"
                    name="timezone"
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>
          
          <Field kind="group" align="right">
            <Control>
              <Button color="info">Update</Button>
            </Control>
          </Field>
        </Column>
      </Column.Group>
    </form>;
  }
  
  public render_account()
  {
    return <form onSubmit={this.update_account.bind(this)}>
      <Column.Group>
        <Column size={6}>
          <Field horizontal>
            <Field.Label size="normal">
              <Label>Custom ID</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    disabled
                    type="text"
                    placeholder="(empty)"
                    name="custom_id"
                  />
                </Control>
                <Control>
                  <Button>Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>
  
          <Field horizontal>
            <Field.Label size="normal">
              <Label>Device ID</Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled
                    type="text"
                    name="device_id"
                    defaultValue="someuniqueid-1"
                  />
                </Control>
                <Control>
                  <Button>Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>
  
          <Field horizontal>
            <Field.Label size="normal">
              <Label></Label>
            </Field.Label>
            <Field.Body>
              <Field kind="addons">
                <Control expanded>
                  <Input
                    disabled
                    type="text"
                    defaultValue="someuniqueid-2"
                    name=""
                  />
                </Control>
                <Control>
                  <Button>Unlink</Button>
                </Control>
              </Field>
            </Field.Body>
          </Field>
  
          <Field horizontal>
            <Field.Label size="normal">
              <Label>Email</Label>
            </Field.Label>
            <Field.Body>
              <Field>
                <Control>
                  <Input
                    disabled
                    type="text"
                    defaultValue="email@address.com"
                    name="email"
                  />
                </Control>
                <Control>
                  <Button>Unlink</Button>
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
                    type="text"
                    name="verified"
                    defaultValue="false"
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
                    placeholder="Wallet"
                    rows="6"
                    name="wallet"
                  />
                </Control>
              </Field>
            </Field.Body>
          </Field>
          
          <Field kind="group" align="right">
            <Control>
              <Button color="info">Update</Button>
            </Control>
          </Field>
        </Column>
      </Column.Group>
    </form>;
  }
  
  public render_friends()
  {
    return <Table fullwidth striped hoverable>
      <Table.Head>
        <Table.Row>
          <Table.Heading>User ID</Table.Heading>
          <Table.Heading>Username</Table.Heading>
          <Table.Heading>State</Table.Heading>
          <Table.Heading>Update Time</Table.Heading>
          <Table.Heading>&nbsp;</Table.Heading>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        <Table.Row onClick="window.location='page-user-details.html';">
          <Table.Cell>43736c58-2c63-46d7-a357-0ad67e078f9b</Table.Cell>
          <Table.Cell>kFkdGhNOZl</Table.Cell>
          <Table.Cell>Invite Received</Table.Cell>
          <Table.Cell>2018-12-16 22:42:45.822557+00</Table.Cell>
          <Table.Cell>
            <Button
              size="small"
              onClick={this.remove_friend.bind(this, null)}
            >Delete</Button>
          </Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table>;
  }
  
  public render_groups()
  {
    return <Table fullwidth striped>
      <Table.Head>
        <Table.Row>
          <Table.Heading>Group ID</Table.Heading>
          <Table.Heading>Name</Table.Heading>
          <Table.Heading>State</Table.Heading>
          <Table.Heading>Update Time</Table.Heading>
          <Table.Heading>&nbsp;</Table.Heading>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        <Table.Row>
          <Table.Cell>4875e77e-d102-4547-a436-67af46951e9e</Table.Cell>
          <Table.Cell>Marvel Heroes</Table.Cell>
          <Table.Cell>Join Request</Table.Cell>
          <Table.Cell>2018-12-16 22:42:45.822557+00</Table.Cell>
          <Table.Cell>
            <Button
              size="small"
              onClick={this.remove_group.bind(this, null)}
            >Delete</Button>
          </Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table>;
  }
  
  public render_wallet()
  {
    return <Table fullwidth striped>
      <Table.Head>
        <Table.Row>
          <Table.Heading>ID</Table.Heading>
          <Table.Heading>Changeset</Table.Heading>
          <Table.Heading>Metadata</Table.Heading>
          <Table.Heading>Update Time</Table.Heading>
          <Table.Heading>&nbsp;</Table.Heading>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        <Table.Row>
          <Table.Cell>9293b42a-a497-4261-a918-55c910bc3b44</Table.Cell>
          <Table.Cell>"balance_usd": 1</Table.Cell>
          <Table.Cell>"gid": "1542394703"</Table.Cell>
          <Table.Cell>2018-11-16 19:22:56.662292+00</Table.Cell>
          <Table.Cell>
            <Button
              size="small"
              onClick={this.remove_wallet.bind(this, null)}
            >Delete</Button>
          </Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table>;
  }
  
  public render()
  {
    const {tab} = this.state;
    return <Generic id="users_details">
      <Header />
      <Section>
        <Column.Group>
          <Sidebar active="users" />
    
          <Column>
            <Level>
              <Level.Item align="left">
                <Level.Item>
                  <Breadcrumb>
                    <Breadcrumb.Item as="span"><Link to="/users">Users</Link></Breadcrumb.Item>
                    <Breadcrumb.Item active>001b0970-3291-4176-b0da-a7743c3036e3</Breadcrumb.Item>
                  </Breadcrumb>
                </Level.Item>
              </Level.Item>
              <Level.Item align="right">
                <Level.Item>
                  <Button>
                    <Icon>
                      <FontAwesomeIcon icon="file-export" />
                    </Icon>
                    <span>Export</span>
                  </Button>
                </Level.Item>
                <Level.Item>
                  <Button>
                    <Icon>
                      <FontAwesomeIcon icon="ban" />
                    </Icon>
                    <span>Ban</span>
                  </Button>
                </Level.Item>
                <Level.Item>
                  <Button>
                    <Icon>
                      <FontAwesomeIcon icon="trash" />
                    </Icon>
                    <span>Delete</span>
                  </Button>
                </Level.Item>
                <Level.Item>
                  <Button>
                    <Icon>
                      <FontAwesomeIcon icon="trash" />
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
              >Friends <Tag>7</Tag></Tab>
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
                  <FontAwesomeIcon icon="link" />
                </Icon>
              </Tab>
            </Tab.Group>
    
            {this[`render_${tab}`]()}
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

export default UsersDetails;
