// Copyright 2017, OpenCensus Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//


package zpages

import (
	"fmt"
	"html/template"
	"strconv"
	"time"

	"go.opencensus.io/trace"
)

var (
	headerTemplate       = template.Must(template.New("header").Parse(headerTemplateString))
	summaryTableTemplate = template.Must(template.New("summary").Funcs(templateFunctions).Parse(summaryTemplateString))
	statsTemplate        = template.Must(template.New("rpcz").Funcs(templateFunctions).Parse(statsTemplateString))
	tracesTableTemplate  = template.Must(template.New("traces").Funcs(templateFunctions).Parse(tracesTableTemplateString))
	footerTemplate       = template.Must(template.New("footer").Parse("</body>\n</html>\n"))

	templateFunctions = template.FuncMap{
		"count":    countFormatter,
		"ms":       msFormatter,
		"rate":     rateFormatter,
		"datarate": dataRateFormatter,
		"even":     even,
		"traceid":  traceIDFormatter,
	}

	headerTemplateString = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>{{.Title}}</title>
<link rel="shortcut icon" href="//www.opencensus.io/favicon.ico"/>
</head>
<body>
<h1>{{.Title}}</h1>
`
	summaryTemplateString = `<table style="border-spacing: 0">
<tr>
<td colspan=1 align=left><b>Span Name</b></td>
<td>&nbsp;&nbsp;|&nbsp;&nbsp;</td><td colspan=1 align="center"><b>Running</b></td>
<td>&nbsp;&nbsp;|&nbsp;&nbsp;</td>
<td colspan=9 align="center"><b>Latency Samples</b></td>
<td>&nbsp;&nbsp;|&nbsp;&nbsp;</td>
<td colspan=1 align="center"><b>Error Samples</b></td>
</tr>
<tr>
<td colspan=1></td>
<td>&nbsp;&nbsp;|&nbsp;&nbsp;</td>
<td colspan=1></td>
<td>&nbsp;&nbsp;|&nbsp;&nbsp;</td>
{{range .LatencyBucketNames}}<th colspan=1 align="center"><b>[{{.}}]</b></th>{{end}}
<td>&nbsp;&nbsp;|&nbsp;&nbsp;</td>
<td colspan=1></td>
</tr>
{{$a := .TracesEndpoint}}
{{$links := .Links}}
{{range $rowindex, $row := .Rows}}
	{{- $name := .Name}}
	{{- if even $rowindex}}<tr style="background: #eee">{{else}}<tr>{{end -}}
	<td>{{.Name}}</td><td>&nbsp;&nbsp;|&nbsp;&nbsp;</td>
	{{- if $links -}}
		<td align="center"><a href="{{$a}}?zspanname={{$name}}&ztype=0">{{.Active}}</a></td>
	{{- else -}}
		<td>{{.Active}}</td>
	{{- end -}}
		<td>&nbsp;&nbsp;|&nbsp;&nbsp;</td>
	{{- if $links -}}
		{{range $index, $value := .Latency}}<td align="center"><a href="{{$a}}?zspanname={{$name}}&ztype=1&zsubtype={{$index}}">{{$value}}</a></td>{{end}}
	{{- else -}}
		{{range .Latency}}<td>{{.}}</td>{{end}}
	{{- end -}}
		<td>&nbsp;&nbsp;|&nbsp;&nbsp;</td>
	{{- if $links -}}
		<td align="center"><a href="{{$a}}?zspanname={{$name}}&ztype=2&zsubtype=0">{{.Errors}}</td>
	{{- else -}}
		<td>{{.Errors}}</td>
	{{- end -}}
	</tr>
{{end}}</table>
`
	tracesTableTemplateString = `
<p><b>Span Name: {{.Name}} </b></p>
<p>{{.Num}} Requests</p>
<pre>
When                       Elapsed (sec)
----------------------------------------
{{range .Rows}}{{printf "%26s" (index .Fields 0)}} {{printf "%12s" (index .Fields 1)}} {{index .Fields 2}}{{.|traceid}}
{{end}}</pre>
<br>
<p><b style="color:blue;">TraceId</b> means sampled request. 
<b style="color:black;">TraceId</b> means not sampled request.</p>
`
	statsTemplateString = `
{{range .StatGroups}}
<p><table bgcolor=#eeeeff width=100%><tr align=center><td><font size=+2>{{.Direction}}</font></td></tr></table></p>
<table bgcolor="#fff5ee" frame=box cellspacing=0 cellpadding=2>

<tr bgcolor="#eee5de">
<th></th><td></td>
<th class="l1" colspan=3>Count</th><td></td>
<th class="l1" colspan=3>Avg latency (ms)</th><td></td>
<th class="l1" colspan=3>Max latency (ms)</th><td></td>
<th class="l1" colspan=3>Rate (rpc/s)</th><td></td>
<th class="l1" colspan=3>Input (MiB/s)</th><td></td>
<th class="l1" colspan=3>Output (MiB/s)</th><td></td>
<th class="l1" colspan=3>Errors</th>
</tr>

<tr bgcolor="#eee5de">
<th align=left>Method</th><td>&nbsp;&nbsp;&nbsp;&nbsp;</td>
<th align=right>Min.</th><th align=right>Hr.</th><th align=right>Tot.</th><td>&nbsp;&nbsp;&nbsp;&nbsp;</td>
<th align=right>Min.</th><th align=right>Hr.</th><th align=right>Tot.</th><td>&nbsp;&nbsp;&nbsp;&nbsp;</td>
<th align=right>Min.</th><th align=right>Hr.</th><th align=right>Tot.</th><td>&nbsp;&nbsp;&nbsp;&nbsp;</td>
<th align=right>Min.</th><th align=right>Hr.</th><th align=right>Tot.</th><td>&nbsp;&nbsp;&nbsp;&nbsp;</td>
<th align=right>Min.</th><th align=right>Hr.</th><th align=right>Tot.</th><td>&nbsp;&nbsp;&nbsp;&nbsp;</td>
<th align=right>Min.</th><th align=right>Hr.</th><th align=right>Tot.</th><td>&nbsp;&nbsp;&nbsp;&nbsp;</td>
<th align=right>Min.</th><th align=right>Hr.</th><th align=right>Tot.</th>
</tr>

<tr><td colspan=33><font size=-2>&nbsp;</font></td></tr>

{{range .Snapshots}}
<tr>
<td><b>{{.Method}}</b></td>
<td></td>
<td align="right">{{.CountMinute|count}}</td>
<td align="right">{{.CountHour|count}}</td>
<td align="right">{{.CountTotal|count}}</td><td></td>
<td align="right">{{.AvgLatencyMinute|ms}}</td>
<td align="right">{{.AvgLatencyHour|ms}}</td>
<td align="right">{{.AvgLatencyTotal|ms}}</td><td></td>
<td align="right">{{.MaxLatencyMinute|ms}}</td>
<td align="right">{{.MaxLatencyHour|ms}}</td>
<td align="right">{{.MaxLatencyTotal|ms}}</td><td></td>
<td align="right">{{.RPCRateMinute|rate}}</td>
<td align="right">{{.RPCRateHour|rate}}</td>
<td align="right">{{.RPCRateTotal|rate}}</td><td></td>
<td align="right">{{.InputRateMinute|datarate}}</td>
<td align="right">{{.InputRateHour|datarate}}</td>
<td align="right">{{.InputRateTotal|datarate}}</td><td></td>
<td align="right">{{.OutputRateMinute|datarate}}</td>
<td align="right">{{.OutputRateHour|datarate}}</td>
<td align="right">{{.OutputRateTotal|datarate}}</td><td></td>
<td align="right">{{.ErrorsMinute|count}}</td>
<td align="right">{{.ErrorsHour|count}}</td>
<td align="right">{{.ErrorsTotal|count}}</td><td></td>
</tr>
{{end}}
</table>
{{end}}
`
)

func countFormatter(num int) string {
	if num == 0 {
		return " "
	}
	var floatVal float64
	var suffix string
	if num >= 1e12 {
		floatVal = float64(num) / 1e9
		suffix = " T "
	} else if num >= 1e9 {
		floatVal = float64(num) / 1e9
		suffix = " G "
	} else if num >= 1e6 {
		floatVal = float64(num) / 1e6
		suffix = " M "
	}

	if floatVal != 0 {
		return fmt.Sprintf("%1.3f%s", floatVal, suffix)
	}
	return fmt.Sprint(num)
}

func msFormatter(d time.Duration) string {
	if d == 0 {
		return "0"
	}
	if d < 10*time.Millisecond {
		return fmt.Sprintf("%.3f", float64(d)*1e-6)
	}
	return strconv.Itoa(int(d / time.Millisecond))
}

func rateFormatter(r float64) string {
	return fmt.Sprintf("%.3f", r)
}

func dataRateFormatter(b float64) string {
	return fmt.Sprintf("%.3f", b/1e6)
}

func traceIDFormatter(r traceRow) template.HTML {
	sc := r.SpanContext
	if sc == (trace.SpanContext{}) {
		return ""
	}
	col := "black"
	if sc.TraceOptions.IsSampled() {
		col = "blue"
	}
	if r.ParentSpanID != (trace.SpanID{}) {
		return template.HTML(fmt.Sprintf(`trace_id: <b style="color:%s">%s</b> span_id: %s parent_span_id: %s`, col, sc.TraceID, sc.SpanID, r.ParentSpanID))
	}
	return template.HTML(fmt.Sprintf(`trace_id: <b style="color:%s">%s</b> span_id: %s`, col, sc.TraceID, sc.SpanID))
}

func even(x int) bool {
	return x%2 == 0
}
