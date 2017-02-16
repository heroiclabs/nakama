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

terraform {
  required_version = ">= 0.8, < 0.9"
}

provider "google" {
  project     = "${var.gce_project_name}"
  region      = "${var.gce_region}"
  credentials = "${file("account.json")}"
}

resource "google_compute_address" "api" {
  name = "api-address"
}

resource "google_compute_target_pool" "api" {
  name          = "api-target-pool"
  instances     = ["${google_compute_instance.api.*.self_link}"]
  health_checks = ["${google_compute_http_health_check.healthcheck.name}"]
}

resource "google_compute_http_health_check" "healthcheck" {
  name                = "api-healthcheck"
  request_path        = "/v0/health"
  check_interval_sec  = 5
  healthy_threshold   = 1
  unhealthy_threshold = 10
  timeout_sec         = 2
}

resource "google_compute_firewall" "api" {
  name    = "api-firewall"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["api-node"]
}

resource "google_compute_disk" "default" {
  name = "api-disk"
  type = "pd-ssd"
  zone = "${var.gce_region_zone}"
  size = 10
}

resource "google_compute_instance" "api" {
  name         = "api-node"
  machine_type = "${var.app_machine_type}"
  zone         = "${var.gce_region_zone}"
  tags         = ["api-node"]

  disk {
    image = "ubuntu-os-cloud/ubuntu-1604-lts"
  }

  disk {
    disk = "${google_compute_disk.default.name}"
  }

  network_interface {
    network = "default"
    access_config {} # Ephemeral
  }

  service_account {
    scopes = ["userinfo-email", "compute-ro", "storage-ro"]
  }

  provisioner "file" {
    source      = "systemd/"
    destination = "/etc/systemd/system"
  }

  provisioner "remote-exec" {
    inline = [
      "curl -s https://binaries.cockroachdb.com/cockroach-${var.app_cockroachdb_version}.linux-amd64.tgz"
      ""
      "" # run migration with nakama
      "" # use upstart for nakama
    ]
  }
}
