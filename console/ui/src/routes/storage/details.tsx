import React, {Component} from 'react';
import {Link} from 'react-router-dom';
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
  Section,
  Select,
  Textarea
} from 'rbx';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 */

type Props = {
  id: string;
};

type State = {
};

class StorageDetails extends Component<Props, State>
{
  render()
  {
    return <Generic id="storage_details">
      <Header />
      <Section>
        <Column.Group>
          <Sidebar active="storage" />

          <Column>
            <Level>
              <Level.Item align="left">
                <Level.Item>
                  <Breadcrumb>
                    <Breadcrumb.Item as="span"><Link to="/storage">Storage</Link></Breadcrumb.Item>
                    <Breadcrumb.Item active>savegames</Breadcrumb.Item>
                    <Breadcrumb.Item active>slot1</Breadcrumb.Item>
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
                      <FontAwesomeIcon icon="trash" />
                    </Icon>
                    <span>Delete</span>
                  </Button>
                </Level.Item>
              </Level.Item>
            </Level>

            <Column.Group>
              <Column size={6}>
                <Field horizontal>
                  <Field.Label size="normal">
                    <Label>Collection</Label>
                  </Field.Label>
                  <Field.Body>
                    <Field>
                      <Control>
                        <Input type="text" value="savegames" />
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
                        <Input type="text" value="slot1" />
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
                        <Input type="text" value="001b0970-3291-4176-b0da-a7743c3036e3" />
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
                        <Input static type="text" value="8f2d67f3755c2cffd9187c178f9b9b36" />
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
                          <Select>
                            <Select.Option value="0">No Read (0)</Select.Option>
                            <Select.Option value="1" selected>Private Read (1)</Select.Option>
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
                          <Select>
                            <Select.Option value="0">No Write (0)</Select.Option>
                            <Select.Option value="1" selected>Private Write (1)</Select.Option>
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
                      <Textarea placeholder="Value" rows={8}>
                      {`{
                        "recipients": [
                          "6197da87-8219-43d0-a631-034d2a485c27",
                          "7d6429f2-ab63-4570-ac63-ab6d6bc4382f"
                        ],
                        "reset_timestamp": 0
                      }`}
                      </Textarea>
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
                        <Input static type="text" value="2018-08-07 11:29:36.764366+00:00" />
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
                        <Input static type="text" value="2018-08-07 11:29:36.764366+00:00" />
                      </Control>
                    </Field>
                  </Field.Body>
                </Field>
              </Column>
            </Column.Group>

            <Field kind="group" align="right">
              <Control>
                <Button color="info" type="submit">Update</Button>
              </Control>
            </Field>
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

export default StorageDetails;
