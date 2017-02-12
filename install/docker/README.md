## Docker Instructions

Prerequisite for following this instruction is Docker. [Install Docker with Docker-Compose](https://docs.docker.com/engine/installation/)

Nakama and Cockroach can run as separate containers, connect to each other and be exposed to the host machine via Docker. This enables you to install, configure and run in one simple step.

1. Save the content of the file [`docker-compose.yml`](https://raw.githubusercontent.com/heroiclabs/nakama/master/install/docker/docker-compose.yml) onto your computer.
2. On the terminal, navigate to the folder where `docker-compose.yml` is located.
3. Run the following command:

```
docker-compose up
```

This will download the latest CockroachDB and Nakama image published on Docker Hub.

4. You have both CockroachDB and Nakama running on your machine.
5. Navigate to [http://localhost:7351](http://localhost:7351) to check that you can access Nakama Dashboard.

Application logs are printed to the terminal as outputs of `docker-compose`.

### Stopping containers

To stop `docker-compose` while it is running, simply press `ctrl-c`. You can alternatively run `docker-compose stop` in the same directory as `docker-compose.yml` and all containers will shutdown gracefully.

Your data within those containers are still safe. You can rerun the containers by running `docker-compose up`.

To stop and remove all data, containers and images from your machine, run `docker-compose down`.

## Build Docker image and push to Docker Hub

1. To build the image locally, run the following command (in the current working directory - where this README is):

If you have updated the version number in the `Dockerfile`, make sure that the new version number is reflected in the command below:

```
docker build -t heroiclabs:nakama-<VERSION> nakama
```

This creates a new image for each version of Nakama.

2. Follow [this instruction](https://docs.docker.com/engine/getstarted/step_six/) to push the image to Docker Hub.

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

Note: You can (optionally) skip Step 2 as the image you create has a different ID (because of the way we create the above).

3. Navigate to [Docker Hub](https://hub.docker.com/r/heroiclabs/nakama/tags/) and view the latest pushed image.
