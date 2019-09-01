arm64v8 support
===

These instructions describes how to build a nakama-server and pluginbuilder docker-image and how to startup the server with docker-compose.

## Steps

1. To build a nakama-server docker imagei for nakama-server version 2.6.0(for other version or git-commits alter the version build-arg) :

```
docker build . --build-arg version="v2.6.0" -t arm64v8/nakama:2.6.0 -f Dockerfile-arm64v8-stretch
```

2. To build nakama pluginbuilder docker-image for a nakama-server version:

```
docker build "$PWD" --file ./Dockerfile.pluginbuilder-arm64v8 --build-arg commit="v2.6.0" --build-arg version=v2.6.0 -t arm64v8/nakama-pluginbuilder:2.6.0
```

3. startup, nakama server and postgres

first modifiy docker-compose-postgres-arm64v8.yml:

``` 
    #postgres
    volumes:
      - /path/to/postgres/datafolder:/var/lib/postgresql/data

    ...
    #nakama
    volumes:
      - /path/to/nakama/data:/nakama/data

```

startup:

```
docker-compose -f docker-compose-postgres-arm64v8.yml up
```

4. build custom module:

To compile to go module in the current folder:
```
docker run --rm -v "$PWD:/go/src/custom_engine" -w "/go/src/custom_engine" arm64v8/nakama-pluginbuilder:2.6.0 build --buildmode=plugin -o ./modules/test_module.so
```

use this modules-folder as nakama-data-folder in the docker-compose file or copy the resulting so-file to the corresponding data-folder 

