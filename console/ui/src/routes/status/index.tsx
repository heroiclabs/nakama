import React, {Component} from 'react';
import moment from 'moment';
import {Box, Generic, Column, Heading, Section, Table, Title} from 'rbx';
import {Bar} from 'react-chartjs-2';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 * https://github.com/reactjs/react-chartjs
 * http://momentjs.com/docs/
 */

class Status extends Component
{
  render()
  {
    const chartColors = {
      white: 'rgb(255, 255, 255)',
      red: 'rgb(255, 99, 132)',
      blue: 'rgb(54, 162, 235)'
    };
    
    function randomNumber(min: any, max: any)
    {
      return Math.random() * (max - min) + min;
    }
    
    function randomBar(date: any, lastClose: any)
    {
      var open = randomNumber(lastClose * 0.95, lastClose * 1.05);
      var close = randomNumber(open * 0.95, open * 1.05);
      return {
        t: date.valueOf(),
        y: close
      };
    }
    
    let date = moment('April 01 2017', 'MMMM DD YYYY');
    const data = [randomBar(date, 30)];
    const labels = [date];
    
    while(data.length < 60)
    {
      date = date.clone().add(1, 'd');
      if (date.isoWeekday() <= 5) {
        data.push(randomBar(date, data[data.length - 1].y));
        labels.push(date);
      }
    }
    
    const cfg = {
      width: 600,
      height: 150,
      data:
      {
        labels: labels,
        datasets: [{
          label: 'nakama-0',
          backgroundColor: chartColors.white,
          borderColor: chartColors.red,
          data: data,
          type: 'line',
          pointRadius: 0,
          fill: false,
          lineTension: 0,
          borderWidth: 2
        }, {
          label: 'nakama-1',
          ackgroundColor: chartColors.white,
          borderColor: chartColors.blue,
          data: data,
          type: 'line',
          pointRadius: 0,
          fill: false,
          lineTension: 0,
          borderWidth: 2
        }]
      },
      options: {
        scales: {
          xAxes: [{
            type: 'time',
            distribution: 'series',
            ticks: {
              source: 'labels'
            }
          }],
          yAxes: [{
            scaleLabel: {
              display: true,
              labelString: 'Latency (ms)'
            }
          }]
        }
      }
    };
    
    return <Generic id="status">
      <Header />
      <Section>
        <Column.Group>
          <Sidebar active="status" />

          <Column>
            <Column.Group multiline>
              <Column size={3}>
                <Box>
                  <Heading>Average Latency (ms)</Heading>
                  <Title as="h3">80.00</Title>
                  <Column.Group multiline>
                    <Column>
                      <Heading>Min.</Heading>
                      <Title as="h3" size={5}>0.00</Title>
                    </Column>
                    <Column>
                      <Heading>Hr.</Heading>
                      <Title as="h3" size={5}>0.00</Title>
                    </Column>
                  </Column.Group>
                </Box>
              </Column>

              <Column size={3}>
                <Box>
                  <Heading>Rate (rpc/s)</Heading>
                  <Title as="h3">0.016</Title>
                  <Column.Group multiline>
                    <Column>
                      <Heading>Min.</Heading>
                      <Title as="h3" size={5}>0.00</Title>
                    </Column>
                    <Column>
                      <Heading>Hr.</Heading>
                      <Title as="h3" size={5}>0.00</Title>
                    </Column>
                  </Column.Group>
                </Box>
              </Column>

              <Column size={3}>
                <Box>
                  <Heading>Input (kb/s)</Heading>
                  <Title as="h3">0.00</Title>
                  <Column.Group multiline>
                    <Column>
                      <Heading>Min.</Heading>
                      <Title as="h3" size={5}>0.00</Title>
                    </Column>
                    <Column>
                      <Heading>Hr.</Heading>
                      <Title as="h3" size={5}>0.00</Title>
                    </Column>
                  </Column.Group>
                </Box>
              </Column>

              <Column size={3}>
                <Box>
                  <Heading>Output (kb/s)</Heading>
                  <Title as="h3">0.00</Title>
                  <Column.Group multiline>
                    <Column>
                      <Heading>Min.</Heading>
                      <Title as="h3" size={5}>0.00</Title>
                    </Column>
                    <Column>
                      <Heading>Hr.</Heading>
                      <Title as="h3" size={5}>0.00</Title>
                    </Column>
                  </Column.Group>
                </Box>
              </Column>
            </Column.Group>
    
            <Column.Group>
              <Column>
                <Table fullwidth striped>
                  <Table.Head>
                    <Table.Row>
                      <Table.Heading>Node Name</Table.Heading>
                      <Table.Heading>
                        <abbr title="Total count of connected sessions.">Sessions</abbr>
                      </Table.Heading>
                      <Table.Heading>
                        <abbr title="Total count of active presences.">Presences</abbr>
                      </Table.Heading>
                      <Table.Heading>
                        <abbr title="Total count of active multiplayer matches.">Authoritative Matches</abbr>
                      </Table.Heading>
                      <Table.Heading>
                        <abbr title="Total count of running goroutines.">Goroutines</abbr>
                      </Table.Heading>
                    </Table.Row>
                  </Table.Head>
                  <Table.Foot>
                    <Table.Row>
                      <Table.Heading />
                      <Table.Heading>227</Table.Heading>
                      <Table.Heading>516</Table.Heading>
                      <Table.Heading>1</Table.Heading>
                      <Table.Heading>809</Table.Heading>
                    </Table.Row>
                  </Table.Foot>
                  <Table.Body>
                    <Table.Row>
                      <Table.Cell>nakama-0</Table.Cell>
                      <Table.Cell>123</Table.Cell>
                      <Table.Cell>307</Table.Cell>
                      <Table.Cell>0</Table.Cell>
                      <Table.Cell>438</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell>nakama-1</Table.Cell>
                      <Table.Cell>104</Table.Cell>
                      <Table.Cell>209</Table.Cell>
                      <Table.Cell>1</Table.Cell>
                      <Table.Cell>371</Table.Cell>
                    </Table.Row>
                  </Table.Body>
                </Table>
              </Column>
            </Column.Group>
    
            <Column.Group>
              <Column>
                <Bar {...cfg} />
                <Bar {...cfg} />
                <Bar {...cfg} />
                <Bar {...cfg} />
              </Column>
            </Column.Group>
          </Column>
        </Column.Group>
      </Section>
    </Generic>;
  }
}

export default Status;
