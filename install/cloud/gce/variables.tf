/*
 * Copyright 2017 The Nakama Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

# The name of the project in GCP.
variable "gce_project_name" {
}

# The region in GCP to provision resources.
variable "gce_region" {
}

# The region zone in GCP to provision resources in.
variable "gce_region_zone" {
}

# The SSH user configuration to access compute instances.
variable "gce_ssh_user" {
}

# The SSH public key file to access compute instances.
variable "gce_ssh_public_key_file" {
}

# The SSH private key file to access the compute instances.
variable "gce_ssh_private_key_file" {
}

# The version of Nakama which will be deployed.
variable "app_nakama_version" {
}

# The version of CockroachDB which will be deployed.
variable "app_cockroachdb_version" {
}

# The machine type to provision in GCP.
variable "app_machine_type" {
}
