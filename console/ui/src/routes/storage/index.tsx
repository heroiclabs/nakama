import React, {Component} from 'react';
import {RouteComponentProps} from 'react-router';
import {
  Button,
  Column,
  Control,
  Dropdown,
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
                  <Field kind="addons">
                    <Control expanded>
                      <Input type="text" placeholder="Find objects for user" />
                    </Control>
                    <Control>
                      <Button>Lookup</Button>
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
                        <Dropdown.Item>
                          <Icon>
                            <FontAwesomeIcon icon="file-csv" />
                          </Icon>
                          <span>Import with CSV</span>
                        </Dropdown.Item>
                        <Dropdown.Item>
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

export default Storage;
