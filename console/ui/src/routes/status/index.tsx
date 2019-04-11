import React, {Component} from 'react';
import moment from 'moment';
import {Box, Generic, Column, Heading, Section, Table, Title} from 'rbx';
import {Bar} from 'react-chartjs-2';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as statusActions from '../../store/status/actions';
import {StatusNodes} from '../../store/status/types';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

/*
 * https://dfee.github.io/rbx/
 * https://github.com/reactjs/react-chartjs
 * http://momentjs.com/docs/
 */

interface PropsFromState
{
  loading: boolean,
  data: StatusNodes,
  errors: string|undefined
}

interface PropsFromDispatch
{
  fetchRequest: typeof statusActions.statusRequest
}

type Props = PropsFromState & PropsFromDispatch & ConnectedReduxProps;

class Status extends Component<Props>
{
  public componentDidMount()
  {
    this.props.fetchRequest();
  }
  
  public render()
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
    const datum = [randomBar(date, 30)];
    const labels = [date];
    
    while(datum.length < 60)
    {
      date = date.clone().add(1, 'd');
      if (date.isoWeekday() <= 5) {
        datum.push(randomBar(date, datum[datum.length - 1].y));
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
          data: datum,
          type: 'line',
          pointRadius: 0,
          fill: false,
          lineTension: 0,
          borderWidth: 2
        }, {
          label: 'nakama-1',
          ackgroundColor: chartColors.white,
          borderColor: chartColors.blue,
          data: datum,
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
    
    const {data} = this.props;
    
    let avg_latency_ms = 0;
    let avg_rate_sec = 0;
    let avg_input_kbs = 0;
    let avg_output_kbs = 0;
    if(data.nodes.length)
    {
      avg_latency_ms = Math.round(
        (
          data.nodes
            .map(n => n.avg_latency_ms)
            .reduce((total, value) => total + value, 0) / data.nodes.length
        ) * 1000
      ) / 1000;
      avg_rate_sec = Math.round(
        (
          data.nodes
            .map(n => n.avg_rate_sec)
            .reduce((total, value) => total + value, 0) / data.nodes.length
        ) * 1000
      ) / 1000;
      avg_input_kbs = Math.round(
        (
          data.nodes
            .map(n => n.avg_input_kbs)
            .reduce((total, value) => total + value, 0) / data.nodes.length
        ) * 1000
      ) / 1000;
      avg_output_kbs = Math.round(
        (
          data.nodes
            .map(n => n.avg_output_kbs)
            .reduce((total, value) => total + value, 0) / data.nodes.length
        ) * 1000
      ) / 1000;
    }
    
    const total_sessions = data.nodes
      .map(n => n.sessions || 0)
      .reduce((total, value) => total + value, 0);
    const total_presences = data.nodes
      .map(n => n.presences || 0)
      .reduce((total, value) => total + value, 0);
    const total_authoritative_matches = data.nodes
      .map(n => n.authoritative_matches || 0)
      .reduce((total, value) => total + value, 0);
    const total_goroutine_count = data.nodes
      .map(n => n.goroutine_count || 0)
      .reduce((total, value) => total + value, 0);
    
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
                  <Title as="h3">{avg_latency_ms}</Title>
                </Box>
              </Column>

              <Column size={3}>
                <Box>
                  <Heading>Rate (rpc/s)</Heading>
                  <Title as="h3">{avg_rate_sec}</Title>
                </Box>
              </Column>

              <Column size={3}>
                <Box>
                  <Heading>Input (kb/s)</Heading>
                  <Title as="h3">{avg_input_kbs}</Title>
                </Box>
              </Column>

              <Column size={3}>
                <Box>
                  <Heading>Output (kb/s)</Heading>
                  <Title as="h3">{avg_output_kbs}</Title>
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
                      <Table.Heading>{total_sessions}</Table.Heading>
                      <Table.Heading>{total_presences}</Table.Heading>
                      <Table.Heading>{total_authoritative_matches}</Table.Heading>
                      <Table.Heading>{total_goroutine_count}</Table.Heading>
                    </Table.Row>
                  </Table.Foot>
                  <Table.Body>
                    {
                      data.nodes.map((n, key) =>
                        <Table.Row key={`cell_${key}`}>
                          <Table.Cell>{n.name}</Table.Cell>
                          <Table.Cell>{n.sessions || 0}</Table.Cell>
                          <Table.Cell>{n.presences || 0}</Table.Cell>
                          <Table.Cell>{n.authoritative_matches || 0}</Table.Cell>
                          <Table.Cell>{n.goroutine_count || 0}</Table.Cell>
                        </Table.Row>
                      )
                    }
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

const mapStateToProps = ({status}: ApplicationState) => ({
  loading: status.loading,
  errors: status.errors,
  data: status.data
});

const mapDispatchToProps = (dispatch: Dispatch) => ({
  fetchRequest: () => dispatch(
    statusActions.statusRequest()
  )
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Status);
