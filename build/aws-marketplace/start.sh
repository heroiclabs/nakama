#!/bin/bash


if [[ -z "$1" ]]; then
  echo "the first argument must be a database host"
  exit 1;
fi
if [[ -z "$2" ]]; then
  echo "the second argument must be a database password for the postgres user"
  exit 1;
fi
/nakama/nakama migrate up --database.address  postgres:$2@$1:5432
if [ $? -ne 0 ]; then
  exit 1;
fi


rm -rf /nakama-data/*
if [ $? -ne 0 ]; then
  exit 2;
fi
mkdir -p /nakama-data && touch /nakama-data/config.yaml
if [ $? -ne 0 ]; then
  exit 2;
fi

if [[ ! -z "$3" ]]; then
  aws s3 cp s3://$3/ /nakama-data/ --recursive
  if [ $? -ne 0 ]; then
    exit 3;
  fi
fi

/nakama/nakama --config /nakama-data/config.yaml --data_dir /nakama-data --runtime.path /nakama-data --database.address postgres:$2@$1:5432