import React, {Component} from 'react';
import {withRouter} from 'react-router-dom';
import {RouteComponentProps} from 'react-router';
import {Button, Column, Control, Field, Generic, Icon, Input, Level, Section, Table, Title} from 'rbx';
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

class Users extends Component<Props, State>
{
  details(id: string)
  {
    const {history} = this.props;
    history.push(`/users/${id}`);
  }
  
  render()
  {
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
                    <strong>8,106,085</strong> users
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
                <Table.Row onClick={this.details.bind(this, '001b0970-3291-4176-b0da-a7743c3036e3')}>
                  <Table.Cell>001b0970-3291-4176-b0da-a7743c3036e3</Table.Cell>
                  <Table.Cell>NPxDpNDrAT</Table.Cell>
                  <Table.Cell>NULL</Table.Cell>
                  <Table.Cell>2018-08-07 11:29:36.764366+00:00</Table.Cell>
                  <Table.Cell>
                    <Button size="small">Delete</Button>
                  </Table.Cell>
                </Table.Row>
                <Table.Row onClick={this.details.bind(this, '0022791e-bd2f-4cc4-8ace-617d86b402fb')}>
                  <Table.Cell>0022791e-bd2f-4cc4-8ace-617d86b402fb</Table.Cell>
                  <Table.Cell>JNbhSTvuNj</Table.Cell>
                  <Table.Cell>NULL</Table.Cell>
                  <Table.Cell>2018-08-07 11:29:36.764366+00:00</Table.Cell>
                  <Table.Cell>
                    <Button size="small">Delete</Button>
                  </Table.Cell>
                </Table.Row>
                <Table.Row onClick={this.details.bind(this, '007d2e07-5d30-45c7-9c99-efa1dfa52e12')}>
                  <Table.Cell>007d2e07-5d30-45c7-9c99-efa1dfa52e12</Table.Cell>
                  <Table.Cell>waLyXIcHwN</Table.Cell>
                  <Table.Cell>NULL</Table.Cell>
                  <Table.Cell>2018-08-07 11:29:36.764366+00:00</Table.Cell>
                  <Table.Cell>
                    <Button size="small">Delete</Button>
                  </Table.Cell>
                </Table.Row>
                <Table.Row onClick={this.details.bind(this, '015c7bf7-8c83-43fb-919a-010365f4fba9')}>
                  <Table.Cell>015c7bf7-8c83-43fb-919a-010365f4fba9</Table.Cell>
                  <Table.Cell>BTqGCvsuMf</Table.Cell>
                  <Table.Cell>NULL</Table.Cell>
                  <Table.Cell>2018-08-07 11:29:36.764366+00:00</Table.Cell>
                  <Table.Cell>
                    <Button size="small">Delete</Button>
                  </Table.Cell>
                </Table.Row>
                <Table.Row onClick={this.details.bind(this, '01baf340-bc4c-4f71-b2ce-7008a0c14e5d')}>
                  <Table.Cell>01baf340-bc4c-4f71-b2ce-7008a0c14e5d</Table.Cell>
                  <Table.Cell>pqWYCaLSyp</Table.Cell>
                  <Table.Cell>NULL</Table.Cell>
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

export default withRouter(Users);
