## Run Nakama with Docker

You'll need to setup `docker-compose` as [described by Docker](https://docs.docker.com/engine/installation/) for this guide.

It's recommended to run Nakama and the database (cockroachdb) as separate containers and connect them together via Docker's virtual network on the host machine. This guide will show you how to install and configure all resources together so it can be run in a single step.

1. Save the [`docker-compose.yml`](https://raw.githubusercontent.com/heroiclabs/nakama/master/install/docker/docker-compose.yml) file onto your computer.

   ```
   wget https://raw.githubusercontent.com/heroiclabs/nakama/master/install/docker/docker-compose.yml
   ```

   This will download `docker-compose.yml` to your current working directory.

2. Navigate to the folder where `docker-compose.yml` is located in a command line console.
3. Run the following command:

    ```
    docker-compose up
    ```

    This will download the latest cockroachdb and Nakama images published on Docker Hub.

4. You have both CockroachDB and Nakama running on your machine.
5. Navigate to [http://localhost:7351](http://localhost:7351) to check that you can view Nakama's embedded dashboard.

All server logs are printed to the console as part of the `docker-compose` output.

## Setup a client

By default the server is started on `127.0.0.1:7350` and dashboard is reachable at [http://127.0.0.1:7351](http://127.0.0.1:7351).

CockroachDB is started on `127.0.0.1:26257` and it's dashboard is available at [http://127.0.0.1:8080](http://127.0.0.1:8080).

Follow one of the client guides to connect to the server:

- [Unity](https://heroiclabs.com/docs/clients/unity/)

## Stop the containers

You can stop `docker-compose` while it is running with `ctrl-c`. You can also run `docker-compose stop` in the same directory as `docker-compose.yml` and all containers will be shutdown gracefully. Your data within these containers is still safe. You can re-run the containers by running `docker-compose up`.

To stop and purge all stored data, containers, and images from your machine. Run `docker-compose down`.

## Build and deploy the Docker image

You can use the Makefile to build Docker images. These steps show a manual way to create your own Docker images of Nakama server.

1. To build the image locally. Setup a local copy of the codebase. Run the following command (in the same directory as this README):

   If you have updated the version number in the `Dockerfile` also update it in the command below:

   ```
   docker build --build-arg version=<VERSION> -t heroiclabs:nakama-<VERSION> nakama
   ```

   This creates a new image for each version of Nakama.

2. Follow [these instructions](https://docs.docker.com/engine/getstarted/step_six/) to push the image to Docker Hub.

   Ensure that you tag the relevant image ID twice so that the `latest` always refers to the most up to date version tag.

   ```
   docker images
   docker tag <IMAGE_ID> heroiclabs/nakama:<VERSION>
   docker tag <IMAGE_ID> heroiclabs/nakama:latest
   ```

   ```
   docker login
   ```

   ```
   docker push heroiclabs/nakama:<VERSION>
   docker push heroiclabs/nakama:latest
   ```

   **Note:** You can (optionally) skip step 2 as the image you create has a different ID (because of the way we create the above).

3. Navigate to [Docker Hub](https://hub.docker.com/r/heroiclabs/nakama/tags/) and view the latest pushed image.
