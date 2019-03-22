import React, {Component} from 'react';
import {withRouter} from 'react-router-dom';
import {RouteComponentProps} from 'react-router';
import {Button, Column, Generic, Icon, Level, Section, Table, Title} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 */

type Props = RouteComponentProps & {
};

type State = {
};

class Storage extends Component<Props, State>
{
  details(id: string)
  {
    const {history} = this.props;
    history.push(`/storage/${id}`);
  }
  
  render()
  {
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
                    <strong>12,106,085</strong> objects
                  </Title>
                </Level.Item>

                <Level.Item>
                  <Button title="Select system-owned objects.">
                    <Icon>
                      <FontAwesomeIcon icon="users-cog" />
                    </Icon>
                  </Button>
                </Level.Item>

                <Level.Item>
                  <div className="field has-addons">
                    <p className="control is-expanded">
                      <input className="input" type="text" placeholder="Find objects for user" />
                    </p>
                    <p className="control">
                      <Button>Lookup</Button>
                    </p>
                  </div>
                </Level.Item>
              </Level.Item>

              <Level.Item align="right">
                <Level.Item>
                  <div className="dropdown is-hoverable">
                    <div className="dropdown-trigger">
                      <button className="button" aria-haspopup="true" aria-controls="dropdown-menu">
                        <span>Import</span>
                        <Icon>
                          <FontAwesomeIcon icon="angle-down" />
                        </Icon>
                      </button>
                    </div>
                    <div className="dropdown-menu" id="dropdown-menu" role="menu">
                      <div className="dropdown-content">
                        <a href="#" className="dropdown-item">
                          <Icon>
                            <FontAwesomeIcon icon="file-csv" />
                          </Icon>
                          <span>Import with CSV</span>
                        </a>
                        <a href="#" className="dropdown-item">
                          <Icon>
                            <FontAwesomeIcon icon="file" />
                          </Icon>
                          <span>Import with JSON</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </Level.Item>

                <Level.Item>
                  <a className="button">
                    <Icon>
                      <FontAwesomeIcon icon="trash" />
                    </Icon>
                    <span>Delete All</span>
                  </a>
                </Level.Item>
              </Level.Item>
            </Level>

            <Table fullwidth striped hoverable>
              <Table.Head>
                <Table.Row>
                  <Table.Heading>Collection</Table.Heading>
                  <Table.Heading>Key</Table.Heading>
                  <Table.Heading>User ID</Table.Heading>
                  <Table.Heading>Update Time</Table.Heading>
                  <Table.Heading>&nbsp;</Table.Heading>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                <Table.Row onClick={this.details.bind(this, '001b0970-3291-4176-b0da-a7743c3036e3')}>
                  <Table.Cell>savegames</Table.Cell>
                  <Table.Cell>slot1</Table.Cell>
                  <Table.Cell>001b0970-3291-4176-b0da-a7743c3036e3</Table.Cell>
                  <Table.Cell>2018-08-07 11:29:36.764366+00:00</Table.Cell>
                  <Table.Cell>
                    <Button size="small">Delete</Button>
                  </Table.Cell>
                </Table.Row>
                <Table.Row onClick={this.details.bind(this, '001b0970-3291-4176-b0da-a7743c3036e3')}>
                  <Table.Cell>savegames</Table.Cell>
                  <Table.Cell>slot2</Table.Cell>
                  <Table.Cell>001b0970-3291-4176-b0da-a7743c3036e3</Table.Cell>
                  <Table.Cell>2018-08-07 11:29:36.764366+00:00</Table.Cell>
                  <Table.Cell>
                    <Button size="small">Delete</Button>
                  </Table.Cell>
                </Table.Row>
                <Table.Row onClick={this.details.bind(this, '001b0970-3291-4176-b0da-a7743c3036e3')}>
                  <Table.Cell>savegames</Table.Cell>
                  <Table.Cell>slot3</Table.Cell>
                  <Table.Cell>001b0970-3291-4176-b0da-a7743c3036e3</Table.Cell>
                  <Table.Cell>2018-08-07 11:29:36.764366+00:00</Table.Cell>
                  <Table.Cell>
                    <Button size="small">Delete</Button>
                  </Table.Cell>
                </Table.Row>
                <Table.Row onClick={this.details.bind(this, '001b0970-3291-4176-b0da-a7743c3036e3')}>
                  <Table.Cell>savegames</Table.Cell>
                  <Table.Cell>slot4</Table.Cell>
                  <Table.Cell>001b0970-3291-4176-b0da-a7743c3036e3</Table.Cell>
                  <Table.Cell>2018-08-07 11:29:36.764366+00:00</Table.Cell>
                  <Table.Cell>
                    <Button size="small">Delete</Button>
                  </Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table>
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

export default withRouter(Storage);
