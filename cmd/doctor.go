// Copyright 2017 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package cmd

import (
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"reflect"
	"strings"
	"time"
)

type config struct {
	Host string
	Port int
}

type Doctor struct {
	config *config
	client *http.Client
}

func DoctorParse(args []string) {
	c := &config{}
	flags := flag.NewFlagSet("doctor", flag.ExitOnError)
	flags.StringVar(&c.Host, "host", "127.0.0.1", "Nakama node IP/hostname to connect to")
	flags.IntVar(&c.Port, "port", 7351, "Nakama node port number to connect to")

	if err := flags.Parse(args); err != nil {
		log.Fatalln("Could not parse doctor flags")
	}

	d := &Doctor{
		config: c,
		client: &http.Client{Timeout: 5 * time.Second},
	}
	d.start()
}

func (d *Doctor) start() {
	log.Printf("host: %s\n", d.config.Host)
	log.Printf("port: %d\n", d.config.Port)

	info := make(map[string]interface{})
	request(d.client, fmt.Sprintf("http://%s:%d/v0/info", d.config.Host, d.config.Port), &info)

	config := make(map[string]interface{})
	request(d.client, fmt.Sprintf("http://%s:%d/v0/config", d.config.Host, d.config.Port), &config)

	for k, v := range info {
		fmt.Printf(k+": %v\n", v)
	}
	fmt.Println("config:\n---")
	printConfig(config, 0)
	fmt.Println("---")

	os.Exit(0)
}

func printConfig(config map[string]interface{}, indent int) {
	for k, v := range config {
		if isProtected(k) {
			fmt.Printf(strings.Repeat(" ", indent)+k+": %v\n", "[PROTECTED]")
		} else {
			if reflect.TypeOf(v).Kind() == reflect.Map {
				fmt.Print(strings.Repeat(" ", indent) + k + ":\n")
				vm, ok := v.(map[string]interface{})
				if !ok {
					log.Fatalln("Error processing config contents")
				} else {
					printConfig(vm, indent+2)
				}
			} else {
				fmt.Printf(strings.Repeat(" ", indent)+k+": %v\n", v)
			}
		}
	}
}

func request(client *http.Client, url string, to interface{}) {
	resp, err := client.Get(url)
	if err != nil {
		log.Fatalf("Error connecting to Nakama node: %s\n", err)
	}
	body, err := ioutil.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		log.Fatalf("Error reading response from Nakama node: %s\n", err)
	}

	err = json.Unmarshal(body, to)
	if err != nil {
		log.Fatalf("Error decoding response from Nakama node: %s\n", err)
	}
}

func isProtected(key string) bool {
	protected := []string{"Dsns", "ServerKey", "EncryptionKey", "Steam", "GossipJoin", "GossipBindAddr"}
	for _, p := range protected {
		if key == p {
			return true
		}
	}
	return false
}
