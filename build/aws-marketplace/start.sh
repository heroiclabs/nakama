#!/bin/bash

set -e

if [[ -z "$1" ]]; then
  echo "the first argument must be a database username"
  exit 1;
fi

if [[ -z "$2" ]]; then
  echo "the second argument must be a database password"
  exit 1;
fi

if [[ -z "$3" ]]; then
  echo "the third argument must be a database host"
  exit 1;
fi

if [[ "$4" == "-setup" ]]; then
  source /setup.sh
  exit 0;
fi

/nakama/nakama migrate up --database.address  nakama:nakama@$3:5432/nakama

rm -rf /nakama-data/*

mkdir -p /nakama-data && touch /nakama-data/config.yaml

if [[ ! -z "$4" ]]; then
  aws s3 cp s3://$4/ /nakama-data/ --recursive
fi

/nakama/nakama --config /nakama-data/config.yaml --data_dir /nakama-data --runtime.path /nakama-data --database.address nakama:nakama@$3:5432/nakama
