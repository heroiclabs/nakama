# RESOURCES

Stackdriver has defined [resource types](https://cloud.google.com/monitoring/api/resources) for monitoring and for each resource type there
are mandatory resource labels. OpenCensus has defined [standard resource](https://github.com/census-instrumentation/opencensus-specs/blob/master/resource/StandardResources.md)
types and labels. 
This document describes the translation from OpenCensus resources to Stackdriver resources
performed by this exporter.

## Mapping between Stackdriver and OpenCensus Resources

### k8s_container

**condition:** resource.type == container

*k8s_container takes a precedence, so GKE will be mapped to k8s_container and its
associated resource labels but it will not contain any gcp_instance specific
resource labels.*


| Item                | OpenCensus         | Stackdriver    |
|---------------------|--------------------|----------------|
| **resource type**   | container          | k8s_container  |
| **resource labels** |                    |                |
|                     | cloud.zone         | location       |
|                     | k8s.cluster.name   | cluster_name   |
|                     | k8s.namespace.name | namespace_name |
|                     | k8s.pod.name       | pod_name       |
|                     | container.name     | container_name |


### gcp_instance
**condition:** cloud.provider == gcp

| Item                | OpenCensus         | Stackdriver    |
|---------------------|--------------------|----------------|
| **resource type**   | cloud              | gcp_instance   |
| **resource labels** |                    |                |
|                     | host.id            | instance_id    |
|                     | cloud.zone         | zone           |


### aws_ec2_instance
**condition:** cloud.provider == aws

| Item                | OpenCensus         | Stackdriver      |
|---------------------|--------------------|------------------|
| **resource type**   |                    |                  |
|                     | cloud              | aws_ec2_instance |
| **resource labels** |                    |                  |
|                     | host.id            | instance_id      |
|                     | cloud.region       | region           |
|                     | cloud.account.id   | aws_account      |

