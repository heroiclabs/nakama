\# Docker Compose

\*\*URL:\*\* https://heroiclabs.com/docs/nakama/getting-started/install/docker/
\*\*Summary:\*\* See the prerequisites and installation procedure for running Nakama via Docker.
\*\*Keywords:\*\* installing nakama, install nakama, nakama docker, nakama docker compose, nakama container, installation, docker, docker compose, postgres
\*\*Categories:\*\* nakama, docker, install

\-\-\-

\# Install Nakama with Docker Compose

\[Docker\](https://www.docker.com/) is the quickest way to download and start developing with Nakama. By using Docker you are able to:

\- Install to a pristine environment
\- Easily install and run the \[CockroachDB\](https://www.cockroachlabs.com/) or \[PostgreSQL\](https://www.postgresql.org/) database for Nakama
\- Take snapshots, remove, and re-install Nakama without affecting your primary operating system
\- Enjoy a quick and simplified installation experience regardless of your OS

Following this guide, you will use \[Docker Compose\](https://docs.docker.com/compose/) to quickly and easily define all the necessary services and run your local development instance of Nakama.

{{< sample-projects-banner title="Prefer hands-on learning?" >}}

\## Prerequisites

Before proceeding ensure that you have \[installed Docker Desktop\](https://docs.docker.com/get-docker/).

{{< note "important" "Linux Users" >}}
Docker Desktop is only available for Mac and Windows. You must install \[Docker Engine\](https://docs.docker.com/engine/install/) and \[Docker Compose\](https://docs.docker.com/compose/install/) individually for your distribution.
{{< / note >}}

\## Running Nakama

1\. Start by creating a directory where your Nakama server will sit, for example \`Desktop/nakama\`.
2\. In this folder create a \`docker-compose.yml\` file and open it using your preferred text editor.
3\. Heroic Labs provides two YML files for use: using either \[PostgreSQL\](https://github.com/heroiclabs/nakama/blob/master/docker-compose-postgres.yml) or \[CockroachDB\](https://github.com/heroiclabs/nakama/blob/master/docker-compose.yml) as the database.

\*\*docker-compose-postgres.yml\*\*

\`\`\`yaml
version: "3"
services:
 postgres:
 container\_name: postgres
 image: postgres:12.2-alpine
 environment:
 \- POSTGRES\_DB=nakama
 \- POSTGRES\_PASSWORD=localdb
 volumes:
 \- data:/var/lib/postgresql/data
 expose:
 \- "8080"
 \- "5432"
 ports:
 \- "5432:5432"
 \- "8080:8080"
 healthcheck:
 test: \["CMD", "pg\_isready", "-U", "postgres", "-d", "nakama"\]
 interval: 3s
 timeout: 3s
 retries: 5
 nakama:
 container\_name: nakama
 image: registry.heroiclabs.com/heroiclabs/nakama:3.22.0
 entrypoint:
 \- "/bin/sh"
 \- "-ecx"
 \- >
 /nakama/nakama migrate up --database.address postgres:localdb@postgres:5432/nakama &&
 exec /nakama/nakama --name nakama1 --database.address postgres:localdb@postgres:5432/nakama --logger.level DEBUG --session.token\_expiry\_sec 7200
 restart: always
 links:
 \- "postgres:db"
 depends\_on:
 postgres:
 condition: service\_healthy
 volumes:
 \- ./:/nakama/data
 expose:
 \- "7349"
 \- "7350"
 \- "7351"
 ports:
 \- "7349:7349"
 \- "7350:7350"
 \- "7351:7351"
 healthcheck:
 test: \["CMD", "/nakama/nakama", "healthcheck"\]
 interval: 10s
 timeout: 5s
 retries: 5
volumes:
 data:
\`\`\`

\*\*docker-compose-cockroach.yml\*\*

\`\`\`yaml
version: "3"
services:
 cockroachdb:
 image: cockroachdb/cockroach:latest-v23.1
 command: start-single-node --insecure --store=attrs=ssd,path=/var/lib/cockroach/
 restart: "no"
 volumes:
 \- data:/var/lib/cockroach
 expose:
 \- "8080"
 \- "26257"
 ports:
 \- "26257:26257"
 \- "8080:8080"
 healthcheck:
 test: \["CMD", "curl", "-f", "http://localhost:8080/health?ready=1"\]
 interval: 3s
 timeout: 3s
 retries: 5
 nakama:
 image: registry.heroiclabs.com/heroiclabs/nakama:3.22.0
 entrypoint:
 \- "/bin/sh"
 \- "-ecx"
 \- >
 /nakama/nakama migrate up --database.address root@cockroachdb:26257 &&
 exec /nakama/nakama --name nakama1 --database.address root@cockroachdb:26257 --logger.level DEBUG --session.token\_expiry\_sec 7200 --metrics.prometheus\_port 9100
 restart: "no"
 links:
 \- "cockroachdb:db"
 depends\_on:
 cockroachdb:
 condition: service\_healthy
 prometheus:
 condition: service\_started
 volumes:
 \- ./:/nakama/data
 expose:
 \- "7349"
 \- "7350"
 \- "7351"
 \- "9100"
 ports:
 \- "7349:7349"
 \- "7350:7350"
 \- "7351:7351"
 healthcheck:
 test: \["CMD", "/nakama/nakama", "healthcheck"\]
 interval: 10s
 timeout: 5s
 retries: 5
 prometheus:
 image: prom/prometheus
 entrypoint: /bin/sh -c
 command: \|
 'sh -s < ./prometheus.yml <}}
You must edit the \`nakama:volumes:\` entry in your \`docker-compose.yml\` file so that it looks like the following: \`/c/Users//projects/docker:/nakama/data\`.
{{< / note >}}

4\. Open a Terminal window and navigate to your Nakama directory. For example:

\`\`\`sh
cd desktop/nakama
\`\`\`

5\. To pull all required images and start your application, run the following:

\`\`\`sh
docker compose up
\`\`\`

6\. Congratulations! Your Nakama server is now up and running, available at \`127.0.0.1:7350\`.

!\[Nakama containers running\]({{< fingerprint\_image "/images/pages/nakama/getting-started/install/docker-nakama-run.png" >}})

Use the \*\*Open in Visual Studio Code\*\* button (or that for your IDE) to edit your \`docker-compose.yml\` file directly.

\## Nakama Console

You can access the \[Nakama Console\](../../console/) by navigating your browser to \[127.0.0.1:7351\](http://127.0.0.1:7351).

When prompted to login, the default credentials are \`admin\` for username and \`password\` for password. These can be changed via configuration file or command-line flags.

\## Configuration

Nakama reads settings from a YAML configuration file. If no file is supplied, Nakama starts with built-in defaults. Start with the \[Server configuration\](../../configuration/) guide to learn how to supply a config file, which options to change first, and how to override values at startup.

When running in Docker, mount the file into the Nakama container and reference it with the \`--config\` flag in \`docker-compose.yml\` so the server reads it at startup. For step-by-step instructions and examples, see the \[Docker configuration\](../../configuration/docker-configuration/) guide.

\## Next steps

With your Nakama server now up and running with the desired configuration, you can get started with your preferred client SDK.