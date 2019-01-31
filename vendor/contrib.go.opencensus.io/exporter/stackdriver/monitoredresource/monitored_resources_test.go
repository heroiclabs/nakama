// Copyright 2018, OpenCensus Authors
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

package monitoredresource

import (
	"os"
	"testing"
)

const (
	GCPProjectIDStr     = "gcp-project"
	GCPInstanceIDStr    = "instance"
	GCPZoneStr          = "us-east1"
	GKENamespaceStr     = "namespace"
	GKEPodIDStr         = "pod-id"
	GKEContainerNameStr = "container"
	GKEClusterNameStr   = "cluster"
)

func TestGKEContainerMonitoredResources(t *testing.T) {
	os.Setenv("KUBERNETES_SERVICE_HOST", "127.0.0.1")
	gcpMetadata := gcpMetadata{
		instanceID:    GCPInstanceIDStr,
		projectID:     GCPProjectIDStr,
		zone:          GCPZoneStr,
		clusterName:   GKEClusterNameStr,
		containerName: GKEContainerNameStr,
		namespaceID:   GKENamespaceStr,
		podID:         GKEPodIDStr,
	}
	autoDetected := detectResourceType(nil, &gcpMetadata)

	if autoDetected == nil {
		t.Fatal("GKEContainerMonitoredResource nil")
	}
	resType, labels := autoDetected.MonitoredResource()
	if resType != "gke_container" ||
		labels["instance_id"] != GCPInstanceIDStr ||
		labels["project_id"] != GCPProjectIDStr ||
		labels["cluster_name"] != GKEClusterNameStr ||
		labels["container_name"] != GKEContainerNameStr ||
		labels["zone"] != GCPZoneStr ||
		labels["namespace_id"] != GKENamespaceStr ||
		labels["pod_id"] != GKEPodIDStr {
		t.Errorf("GKEContainerMonitoredResource Failed: %v", autoDetected)
	}
}

func TestGCEInstanceMonitoredResources(t *testing.T) {
	os.Setenv("KUBERNETES_SERVICE_HOST", "")
	gcpMetadata := gcpMetadata{
		instanceID: GCPInstanceIDStr,
		projectID:  GCPProjectIDStr,
		zone:       GCPZoneStr,
	}
	autoDetected := detectResourceType(nil, &gcpMetadata)

	if autoDetected == nil {
		t.Fatal("GCEInstanceMonitoredResource nil")
	}
	resType, labels := autoDetected.MonitoredResource()
	if resType != "gce_instance" ||
		labels["instance_id"] != GCPInstanceIDStr ||
		labels["project_id"] != GCPProjectIDStr ||
		labels["zone"] != GCPZoneStr {
		t.Errorf("GCEInstanceMonitoredResource Failed: %v", autoDetected)
	}
}

func TestAWSEC2InstanceMonitoredResources(t *testing.T) {
	os.Setenv("KUBERNETES_SERVICE_HOST", "")
	gcpMetadata := gcpMetadata{}

	awsIdentityDoc := &awsIdentityDocument{
		"123456789012",
		"i-1234567890abcdef0",
		"us-west-2",
	}
	autoDetected := detectResourceType(awsIdentityDoc, &gcpMetadata)

	if autoDetected == nil {
		t.Fatal("AWSEC2InstanceMonitoredResource nil")
	}
	resType, labels := autoDetected.MonitoredResource()
	if resType != "aws_ec2_instance" ||
		labels["instance_id"] != "i-1234567890abcdef0" ||
		labels["aws_account"] != "123456789012" ||
		labels["region"] != "aws:us-west-2" {
		t.Errorf("AWSEC2InstanceMonitoredResource Failed: %v", autoDetected)
	}
}
