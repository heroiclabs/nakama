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
  port                = 8081
  request_path        = "/v0/health"
  check_interval_sec  = 5
  healthy_threshold   = 1
  unhealthy_threshold = 3
  timeout_sec         = 2
}

resource "google_compute_firewall" "api" {
  name    = "api-firewall"
  network = "default"

  allow {
    protocol = "icmp"
  }

  allow {
    protocol = "tcp"
    ports    = ["22", "80", "443"]
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
  count        = 1
  name         = "api-node-${count.index}"
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

  metadata {
    ssh-keys = "${var.gce_ssh_user}:${file(var.gce_ssh_public_key_file)}"
  }

  provisioner "file" {
    connection {
      user        = "${var.gce_ssh_user}"
      private_key = "${file(var.gce_ssh_private_key_file)}"
      agent       = false
      timeout     = "30s"
    }
    source      = "systemd/"
    destination = "/etc/systemd/system"
  }

  provisioner "remote-exec" {
    connection {
      user        = "${var.gce_ssh_user}"
      private_key = "${file(var.gce_ssh_private_key_file)}"
      agent       = false
      timeout     = "30s"
    }
    inline = [
      "cd /home/ubuntu",

      # Setup cockroachdb
      "wget --no-verbose https://binaries.cockroachdb.com/cockroach-${var.app_cockroachdb_version}.linux-amd64.tgz",
      "tar zxvf cockroach-${var.app_cockroachdb_version}.linux-amd64.tgz",
      "chmod +x ./cockroach-${var.app_cockroachdb_version}.linux-amd64/cockroach",
      "ln -s ./cockroach-${var.app_cockroachdb_version}.linux-amd64/cockroach /home/ubuntu/cockroach",
      "systemctl start cockroach",

      # Setup nakama
      "wget --no-verbose https://github.com/heroiclabs/nakama/releases/download/v${var.app_nakama_version}/nakama-${var.app_nakama_version}-linux-amd64.tar.gz",
      "mkdir -p nakama-${var.app_nakama_version}-linux-amd64",
      "tar zxvf nakama-${var.app_nakama_version}-linux-amd64.tar.gz -C nakama-${var.app_nakama_version}-linux-amd64",
      "chmod +x ./nakama-${var.app_nakama_version}-linux-amd64/nakama",
      "ln -s ./nakama-${var.app_nakama_version}-linux-amd64/nakama",
      "./nakama migrate up --db root@127.0.0.1:26257",
      "systemctl start nakama"
    ]
  }
}
