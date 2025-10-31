#!/bin/bash

set -exu

buf generate --template apigrpc/apigrpc.gen.yaml apigrpc -o apigrpc/
buf generate --template console/console.gen.yaml console -o console/
