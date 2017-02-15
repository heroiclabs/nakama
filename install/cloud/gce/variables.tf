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

variable "gce_project_name" {
  default = "myproject"
}

variable "gce_region" {
  default = "us-east1"
}

variable "gce_region_zone" {
  default = "us-east1-b"
}

variable "app_nakama_version" {
  default = "0.11.1"
}

variable "app_cockroachdb_version" {
  default = "beta-20170209"
}

variable "app_machine_type" {
  default = "g1-small"
}
