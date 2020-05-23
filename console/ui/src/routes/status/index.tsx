import React, {Component} from 'react';
import {Box, Column, Generic, Heading, Section, Table, Title} from 'rbx';
import {Bar} from 'react-chartjs-2';

import {Dispatch} from 'redux';
import {connect} from 'react-redux';
import {ApplicationState, ConnectedReduxProps} from '../../store';
import * as statusActions from '../../store/status/actions';
import {Node, StatusNodes} from '../../store/status/types';

import Header from '../../components/header';
import Sidebar from '../../components/sidebar';

interface PropsFromState {
  loading: boolean,
  data: StatusNodes,
  errors: string | undefined
}

interface PropsFromDispatch {
  fetchRequest: typeof statusActions.statusRequest
}

type Props = PropsFromState & PropsFromDispatch & ConnectedReduxProps;

type Point = {
  t: any,
  y: number
};

type State = {
  [key: string]: any,
  avg_latency_ms: number,
  avg_rate_sec: number,
  avg_input_kbs: number,
  avg_output_kbs: number,
  labels: any[],
  latency_ms: Point[],
  rate_sec: Point[],
  input_kbs: Point[],
  output_kbs: Point[],
  interval: undefined | number
};

class Status extends Component<Props, State> {
  public constructor(props: Props) {
    super(props);
    let labels = [];
    let latency_ms = [];
    let rate_sec = [];
    let input_kbs = [];
    let output_kbs = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getTime() - (i * 5000));
      const t = d.valueOf();
      labels.push(d)
      latency_ms.push({
        t,
        y: 0
      });
      rate_sec.push({
        t,
        y: 0
      });
      input_kbs.push({
        t,
        y: 0
      });
      output_kbs.push({
        t,
        y: 0
      });
    }
    this.state = {
      avg_latency_ms: 0,
      avg_rate_sec: 0,
      avg_input_kbs: 0,
      avg_output_kbs: 0,
      labels: labels,
      latency_ms: latency_ms,
      rate_sec: rate_sec,
      input_kbs: input_kbs,
      output_kbs: output_kbs,
      interval: undefined
    };
  }

  public componentWillReceiveProps(next: Props) {
    const {
      latency_ms,
      rate_sec,
      input_kbs,
      output_kbs,
      labels
    } = this.state;
    const {data} = next;
    const now = new Date();
    const t = now.valueOf();

    if (data && data.nodes && data.nodes.length == 0) {
      data.nodes.push({
        name: "",
        avg_latency_ms: NaN,
        avg_rate_sec: NaN,
        avg_input_kbs: NaN,
        avg_output_kbs: NaN
      } as Node);
    }

    if (
      data &&
      data.nodes &&
      data.nodes.length &&
      (
        !latency_ms.length ||
        (t - latency_ms[latency_ms.length - 1].t) > 3000
      )
    ) {
      let avg_latency_ms = 0;
      let avg_rate_sec = 0;
      let avg_input_kbs = 0;
      let avg_output_kbs = 0;
      if (data.nodes[0].avg_latency_ms) {
        avg_latency_ms = Math.round(
          (
            data.nodes
              .map(n => n.avg_latency_ms)
              .reduce((total, value) => total + value, 0) / data.nodes.length
          ) * 1000
        ) / 1000;
      }
      if (data.nodes[0].avg_rate_sec) {
        avg_rate_sec = Math.round(
          (
            data.nodes
              .map(n => n.avg_rate_sec)
              .reduce((total, value) => total + value, 0) / data.nodes.length
          ) * 1000
        ) / 1000;
      }
      if (data.nodes[0].avg_input_kbs) {
        avg_input_kbs = Math.round(
          (
            data.nodes
              .map(n => n.avg_input_kbs)
              .reduce((total, value) => total + value, 0) / data.nodes.length
          ) * 1000
        ) / 1000;
      }
      if (data.nodes[0].avg_output_kbs) {
        avg_output_kbs = Math.round(
          (
            data.nodes
              .map(n => n.avg_output_kbs)
              .reduce((total, value) => total + value, 0) / data.nodes.length
          ) * 1000
        ) / 1000;
      }

      labels.push(now);
      latency_ms.push({
        t,
        y: avg_latency_ms
      });
      rate_sec.push({
        t,
        y: avg_rate_sec
      });
      input_kbs.push({
        t,
        y: avg_input_kbs
      });
      output_kbs.push({
        t,
        y: avg_output_kbs
      });

      if (labels.length > 24) {
        labels.shift();
      }
      if (latency_ms.length > 24) {
        latency_ms.shift();
      }
      if (rate_sec.length > 24) {
        rate_sec.shift();
      }
      if (input_kbs.length > 24) {
        input_kbs.shift();
      }
      if (output_kbs.length > 24) {
        output_kbs.shift();
      }

      this.setState({
        avg_latency_ms,
        avg_rate_sec,
        avg_input_kbs,
        avg_output_kbs,
        labels,
        latency_ms,
        rate_sec,
        input_kbs,
        output_kbs
      });
    }
  }

  public componentDidMount() {
    this.props.fetchRequest();
    this.setState({interval: window.setInterval(this.props.fetchRequest, 5000) as number});
  }

  public componentWillUnmount() {
    window.clearInterval(this.state.interval);
    this.setState({interval: undefined});
  }

  public generate_cfg(type: string) {
    const {data} = this.props;
    const {labels} = this.state;
    const chartColors = [
      'rgb(255, 255, 255)',
      'rgb(255, 99, 132)',
      'rgb(54, 162, 235)'
    ];
    const types: { [key: string]: string } = {
      latency_ms: 'Latency (ms)',
      rate_sec: 'Rate (rpc/s)',
      input_kbs: 'Input (kb/s)',
      output_kbs: 'Output (kb/s)'
    };

    return {
      width: 600,
      height: 150,
      data:
        {
          labels,
          datasets: data.nodes.map((n, i) => ({
            label: n.name,
            backgroundColor: chartColors[0],
            borderColor: chartColors[i + 1] || chartColors[1],
            data: this.state[type],
            type: 'line',
            pointRadius: 0,
            fill: false,
            lineTension: 0.2,
            spanGaps: false,
            borderWidth: 2
          }))
        },
      options: {
        animation: false,
        scales: {
          // https://www.chartjs.org/docs/latest/axes/cartesian/time.html
          xAxes: [{
            type: 'time',
            distribution: 'series',
            time:
              {
                displayFormats:
                  {
                    second: 'HH:mm:ss'
                  }
              },
            ticks:
              {
                autoSkip: true,
                autoSkipPadding: 10,
                source: 'labels'
              }
          }],
          yAxes: [{
            ticks:
              {
                beginAtZero: true
              },
            scaleLabel:
              {
                display: true,
                labelString: types[type]
              }
          }]
        }
      }
    };
  }

  public render() {
    const {
      avg_latency_ms,
      avg_rate_sec,
      avg_input_kbs,
      avg_output_kbs
    } = this.state;
    const {data} = this.props;

    const cfg_latency_ms = this.generate_cfg('latency_ms');
    const cfg_rate_sec = this.generate_cfg('rate_sec');
    const cfg_input_kbs = this.generate_cfg('input_kbs');
    const cfg_output_kbs = this.generate_cfg('output_kbs');

    const total_sessions = data.nodes
      .map(n => n.session_count || 0)
      .reduce((total, value) => total + value, 0);
    const total_presences = data.nodes
      .map(n => n.presence_count || 0)
      .reduce((total, value) => Math.max(total, value), 0);
    const total_authoritative_matches = data.nodes
      .map(n => n.match_count || 0)
      .reduce((total, value) => total + value, 0);
    const total_goroutine_count = data.nodes
      .map(n => n.goroutine_count || 0)
      .reduce((total, value) => total + value, 0);

    return <Generic id="status">
      <Header/>
      <Section>
        <Column.Group>
          <Sidebar active="status"/>

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
                      <Table.Heading/>
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
                          <Table.Cell>{n.session_count || 0}</Table.Cell>
                          <Table.Cell>{n.presence_count || 0}</Table.Cell>
                          <Table.Cell>{n.match_count || 0}</Table.Cell>
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
                <Bar {...cfg_latency_ms} redraw/>
                <Bar {...cfg_rate_sec} redraw/>
                <Bar {...cfg_input_kbs} redraw/>
                <Bar {...cfg_output_kbs} redraw/>
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
