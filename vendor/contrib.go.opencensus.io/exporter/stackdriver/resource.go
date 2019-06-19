// Copyright 2019, OpenCensus Authors
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

package stackdriver // import "contrib.go.opencensus.io/exporter/stackdriver"

import (
	"fmt"

	"go.opencensus.io/resource"
	"go.opencensus.io/resource/resourcekeys"
	monitoredrespb "google.golang.org/genproto/googleapis/api/monitoredres"
)

type resourceMap struct {
	// Mapping from the input resource type to the monitored resource type in Stackdriver.
	srcType, dstType string
	// Mapping from Stackdriver monitored resource label to an OpenCensus resource label.
	labels map[string]string
}

// Resource labels that are generally internal to the exporter.
// Consider exposing these labels and a type identifier in the future to allow
// for customization.
const (
	stackdriverLocation             = "contrib.opencensus.io/exporter/stackdriver/location"
	stackdriverProjectID            = "contrib.opencensus.io/exporter/stackdriver/project_id"
	stackdriverGenericTaskNamespace = "contrib.opencensus.io/exporter/stackdriver/generic_task/namespace"
	stackdriverGenericTaskJob       = "contrib.opencensus.io/exporter/stackdriver/generic_task/job"
	stackdriverGenericTaskID        = "contrib.opencensus.io/exporter/stackdriver/generic_task/task_id"
)

// Mappings for the well-known OpenCensus resources to applicable Stackdriver resources.
var k8sResourceMap = map[string]string{
	"project_id":     stackdriverProjectID,
	"location":       resourcekeys.CloudKeyZone,
	"cluster_name":   resourcekeys.K8SKeyClusterName,
	"namespace_name": resourcekeys.K8SKeyNamespaceName,
	"pod_name":       resourcekeys.K8SKeyPodName,
	"container_name": resourcekeys.ContainerKeyName,
}

var gcpResourceMap = map[string]string{
	"project_id":  stackdriverProjectID,
	"instance_id": resourcekeys.HostKeyID,
	"zone":        resourcekeys.CloudKeyZone,
}

var awsResourceMap = map[string]string{
	"project_id":  stackdriverProjectID,
	"instance_id": resourcekeys.HostKeyID,
	"region":      resourcekeys.CloudKeyRegion,
	"aws_account": resourcekeys.CloudKeyAccountID,
}

// Generic task resource.
var genericResourceMap = map[string]string{
	"project_id": stackdriverProjectID,
	"location":   stackdriverLocation,
	"namespace":  stackdriverGenericTaskNamespace,
	"job":        stackdriverGenericTaskJob,
	"task_id":    stackdriverGenericTaskID,
}

func transformResource(match, input map[string]string) map[string]string {
	output := make(map[string]string, len(input))
	for dst, src := range match {
		if v, ok := input[src]; ok {
			output[dst] = v
		}
	}
	return output
}

func defaultMapResource(res *resource.Resource) *monitoredrespb.MonitoredResource {
	match := genericResourceMap
	result := &monitoredrespb.MonitoredResource{
		Type: "global",
	}
	if res == nil || res.Labels == nil {
		return result
	}
	if res.Type == resourcekeys.ContainerType {
		result.Type = "k8s_container"
		match = k8sResourceMap
	} else if v, ok := res.Labels[resourcekeys.CloudKeyProvider]; ok {
		if v == resourcekeys.CloudProviderGCP {
			result.Type = "gce_instance"
			match = gcpResourceMap
		} else if v == resourcekeys.CloudProviderAWS {
			result.Type = "aws_ec2_instance"
			match = awsResourceMap
		}
	}
	result.Labels = transformResource(match, res.Labels)
	if result.Type == "aws_ec2_instance" {
		if v, ok := result.Labels["region"]; ok {
			result.Labels["region"] = fmt.Sprintf("aws:%s", v)
		}
	}
	return result
}
