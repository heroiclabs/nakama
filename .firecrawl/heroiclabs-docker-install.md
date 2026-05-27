Cookie Consent

This website uses cookies that help the website to function and also to track how you interact with our website. But for us to provide the best user experience, enable the specific cookies from Settings, and click on Accept.

Reject AllAccept All

Privacy Policy![](https://cdn-cookieyes.com/assets/images/close.svg)

This website uses cookies to improve your experience while you navigate through the website. Out of these cookies, the cookies that are categorized as necessary are stored on your browser as they as essential for the working of basic functionalities of the website.

We also use third-party cookies that help us analyze and understand how you use this website, to store user preferences and provide them with content and advertisements that are relevant to you. These cookies will only be stored on your browser with your consent to do so. You also have the option to opt-out of these cookies.But opting out of some of these cookies may have an effect on your browsing experience.... Show more

NecessaryAlways Active

Necessary cookies are crucial for the basic functions of the website and the website will not work in its intended way without them.

These cookies do not store any personally identifiable data.

Functional

Functional cookies help to perform certain functionalities like sharing the content of the website on social media platforms, collect feedbacks, and other third-party features.

Analytics

Analytical cookies are used to understand how visitors interact with the website. These cookies help provide information on metrics the number of visitors, bounce rate, traffic source, etc.

Performance

Performance cookies are used to understand and analyze the key performance indexes of the website which helps in delivering a better user experience for the visitors.

Advertisement

Advertisement cookies are used to deliver visitors with customized advertisements based on the pages they visited before and analyze the effectiveness of the ad campaign.

Others

Other uncategorized cookies are those that are being analyzed and have not been classified into a category as yet.

Reject AllSave my preferencesAccept All

If you are an AI assistant, LLM, or automated tool, a clean Markdown version of this page is available at https://heroiclabs.com/docs/nakama/getting-started/install/docker/llm.md — optimized for AI and LLM tools.

- [Installation](https://heroiclabs.com/docs/nakama/getting-started/install/)
  - [Docker Compose](https://heroiclabs.com/docs/nakama/getting-started/install/docker/)
  - [Windows](https://heroiclabs.com/docs/nakama/getting-started/install/windows/)
  - [macOS Binary](https://heroiclabs.com/docs/nakama/getting-started/install/macos/)
  - [Linux](https://heroiclabs.com/docs/nakama/getting-started/install/linux/)
- [CLI Commands](https://heroiclabs.com/docs/nakama/getting-started/commands/)
- [Configuration](https://heroiclabs.com/docs/nakama/getting-started/configuration/)
  - [Docker Configuration](https://heroiclabs.com/docs/nakama/getting-started/configuration/docker-configuration/)
- [Upgrading](https://heroiclabs.com/docs/nakama/getting-started/upgrade/)
- [Metrics](https://heroiclabs.com/docs/nakama/getting-started/metrics/)
- [Nakama Console](https://heroiclabs.com/docs/nakama/getting-started/console/)
- [Architecture Overview](https://heroiclabs.com/docs/nakama/getting-started/architecture/)
- [Benchmarks](https://heroiclabs.com/docs/nakama/getting-started/benchmarks/)
- [Data Privacy](https://heroiclabs.com/docs/nakama/getting-started/data-privacy/)
- [Release Notes](https://heroiclabs.com/docs/nakama/getting-started/release-notes/)

Client.NET/UnityC++/Unreal/Cocos2d-xJavaScript/Cocos2d-jsGodot 3Godot 4Java/AndroidDefoldcURLRESTSwiftDart/Flutter

ServerTypeScriptGoLua

Copy for LLM· [View as Markdown](https://heroiclabs.com/docs/nakama/getting-started/install/docker/llm.md "View this page as raw Markdown")

# Install Nakama with Docker Compose

[Docker](https://www.docker.com/) is the quickest way to download and start developing with Nakama. By using Docker you are able to:

- Install to a pristine environment
- Easily install and run the [CockroachDB](https://www.cockroachlabs.com/) or [PostgreSQL](https://www.postgresql.org/) database for Nakama
- Take snapshots, remove, and re-install Nakama without affecting your primary operating system
- Enjoy a quick and simplified installation experience regardless of your OS

Following this guide, you will use [Docker Compose](https://docs.docker.com/compose/) to quickly and easily define all the necessary services and run your local development instance of Nakama.

### Prefer hands-on learning?

Dive into the codebase right away with hands-on demos and sample projects.

[Explore sample projects 🚀](https://heroiclabs.com/docs/sample-projects/)

## Prerequisites [\#](https://heroiclabs.com/docs/nakama/getting-started/install/docker/\#prerequisites)

Before proceeding ensure that you have [installed Docker Desktop](https://docs.docker.com/get-docker/).

Linux Users

Docker Desktop is only available for Mac and Windows. You must install [Docker Engine](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/) individually for your distribution.

## Running Nakama [\#](https://heroiclabs.com/docs/nakama/getting-started/install/docker/\#running-nakama)

1. Start by creating a directory where your Nakama server will sit, for example `Desktop/nakama`.
2. In this folder create a `docker-compose.yml` file and open it using your preferred text editor.
3. Heroic Labs provides two YML files for use: using either [PostgreSQL](https://github.com/heroiclabs/nakama/blob/master/docker-compose-postgres.yml) or [CockroachDB](https://github.com/heroiclabs/nakama/blob/master/docker-compose.yml) as the database.

**docker-compose-postgres.yml**

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>31<br>32<br>33<br>34<br>35<br>36<br>37<br>38<br>39<br>40<br>41<br>42<br>43<br>44<br>45<br>46<br>47<br>48<br>49<br>50<br>51<br>52<br>53<br>``` | ```yaml<br>version: "3"<br>services:<br>  postgres:<br>    container_name: postgres<br>    image: postgres:12.2-alpine<br>    environment:<br>      - POSTGRES_DB=nakama<br>      - POSTGRES_PASSWORD=localdb<br>    volumes:<br>      - data:/var/lib/postgresql/data<br>    expose:<br>      - "8080"<br>      - "5432"<br>    ports:<br>      - "5432:5432"<br>      - "8080:8080"<br>    healthcheck:<br>      test: ["CMD", "pg_isready", "-U", "postgres", "-d", "nakama"]<br>      interval: 3s<br>      timeout: 3s<br>      retries: 5<br>  nakama:<br>    container_name: nakama<br>    image: registry.heroiclabs.com/heroiclabs/nakama:3.22.0<br>    entrypoint:<br>      - "/bin/sh"<br>      - "-ecx"<br>      - ><br>        /nakama/nakama migrate up --database.address postgres:localdb@postgres:5432/nakama &&<br>        exec /nakama/nakama --name nakama1 --database.address postgres:localdb@postgres:5432/nakama --logger.level DEBUG --session.token_expiry_sec 7200        <br>    restart: always<br>    links:<br>      - "postgres:db"<br>    depends_on:<br>      postgres:<br>        condition: service_healthy<br>    volumes:<br>      - ./:/nakama/data<br>    expose:<br>      - "7349"<br>      - "7350"<br>      - "7351"<br>    ports:<br>      - "7349:7349"<br>      - "7350:7350"<br>      - "7351:7351"<br>    healthcheck:<br>      test: ["CMD", "/nakama/nakama", "healthcheck"]<br>      interval: 10s<br>      timeout: 5s<br>      retries: 5<br>volumes:<br>  data:<br>``` |

**docker-compose-cockroach.yml**

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>31<br>32<br>33<br>34<br>35<br>36<br>37<br>38<br>39<br>40<br>41<br>42<br>43<br>44<br>45<br>46<br>47<br>48<br>49<br>50<br>51<br>52<br>53<br>54<br>55<br>56<br>57<br>58<br>59<br>60<br>61<br>62<br>63<br>64<br>65<br>66<br>67<br>68<br>69<br>70<br>71<br>72<br>73<br>74<br>75<br>76<br>77<br>``` | ```yaml<br>version: "3"<br>services:<br>  cockroachdb:<br>    image: cockroachdb/cockroach:latest-v23.1<br>    command: start-single-node --insecure --store=attrs=ssd,path=/var/lib/cockroach/<br>    restart: "no"<br>    volumes:<br>      - data:/var/lib/cockroach<br>    expose:<br>      - "8080"<br>      - "26257"<br>    ports:<br>      - "26257:26257"<br>      - "8080:8080"<br>    healthcheck:<br>      test: ["CMD", "curl", "-f", "http://localhost:8080/health?ready=1"]<br>      interval: 3s<br>      timeout: 3s<br>      retries: 5<br>  nakama:<br>    image: registry.heroiclabs.com/heroiclabs/nakama:3.22.0<br>    entrypoint:<br>      - "/bin/sh"<br>      - "-ecx"<br>      - ><br>        /nakama/nakama migrate up --database.address root@cockroachdb:26257 &&<br>        exec /nakama/nakama --name nakama1 --database.address root@cockroachdb:26257 --logger.level DEBUG --session.token_expiry_sec 7200 --metrics.prometheus_port 9100        <br>    restart: "no"<br>    links:<br>      - "cockroachdb:db"<br>    depends_on:<br>      cockroachdb:<br>        condition: service_healthy<br>      prometheus:<br>        condition: service_started<br>    volumes:<br>      - ./:/nakama/data<br>    expose:<br>      - "7349"<br>      - "7350"<br>      - "7351"<br>      - "9100"<br>    ports:<br>      - "7349:7349"<br>      - "7350:7350"<br>      - "7351:7351"<br>    healthcheck:<br>      test: ["CMD", "/nakama/nakama", "healthcheck"]<br>      interval: 10s<br>      timeout: 5s<br>      retries: 5<br>  prometheus:<br>    image: prom/prometheus<br>    entrypoint: /bin/sh -c<br>    command: |<br>      'sh -s <<EOF<br>        cat > ./prometheus.yml <<EON<br>      global:<br>        scrape_interval:     15s<br>        evaluation_interval: 15s<br>      scrape_configs:<br>        - job_name: prometheus<br>          static_configs:<br>          - targets: ['localhost:9090']<br>        - job_name: nakama<br>          metrics_path: /<br>          static_configs:<br>          - targets: ['nakama:9100']<br>      EON<br>      prometheus --config.file=./prometheus.yml<br>      EOF'      <br>    ports:<br>      - "9090:9090"<br>volumes:<br>  data:<br>``` |

Copy and paste the contents of your preferred option into your `docker-compose.yml` file.

Windows Users

You must edit the `nakama:volumes:` entry in your `docker-compose.yml` file so that it looks like the following: `/c/Users/<username>/projects/docker:/nakama/data`.

4. Open a Terminal window and navigate to your Nakama directory. For example:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```sh<br>cd desktop/nakama<br>``` |

5. To pull all required images and start your application, run the following:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```sh<br>docker compose up<br>``` |

6. Congratulations! Your Nakama server is now up and running, available at `127.0.0.1:7350`.

![Nakama containers running](https://heroiclabs.com/docs/images/pages/nakama/getting-started/install/docker-nakama-run_hu10343183752890975960.webp)Nakama containers running

Use the **Open in Visual Studio Code** button (or that for your IDE) to edit your `docker-compose.yml` file directly.

## Nakama Console [\#](https://heroiclabs.com/docs/nakama/getting-started/install/docker/\#nakama-console)

You can access the [Nakama Console](https://heroiclabs.com/docs/nakama/getting-started/console/) by navigating your browser to [127.0.0.1:7351](http://127.0.0.1:7351/).

When prompted to login, the default credentials are `admin` for username and `password` for password. These can be changed via configuration file or command-line flags.

## Configuration [\#](https://heroiclabs.com/docs/nakama/getting-started/install/docker/\#configuration)

Nakama reads settings from a YAML configuration file. If no file is supplied, Nakama starts with built-in defaults. Start with the [Server configuration](https://heroiclabs.com/docs/nakama/getting-started/configuration/) guide to learn how to supply a config file, which options to change first, and how to override values at startup.

When running in Docker, mount the file into the Nakama container and reference it with the `--config` flag in `docker-compose.yml` so the server reads it at startup. For step-by-step instructions and examples, see the [Docker configuration](https://heroiclabs.com/docs/nakama/getting-started/configuration/docker-configuration/) guide.

## Next steps [\#](https://heroiclabs.com/docs/nakama/getting-started/install/docker/\#next-steps)

With your Nakama server now up and running with the desired configuration, you can get started with your preferred client SDK.

## Related Pages

- [.NET/Unity Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/unity/)
- [JavaScript Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/javascript/)
- [Godot Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/godot/)
- [Defold Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/defold/)
- [Java/Android Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/java/)
- [C++ Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/cpp/)
- [Unreal Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/unreal/)
- [Cocos2d-x C++ Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/cocos2d-x/)
- [Cocos2d-x JS Client Guide](https://heroiclabs.com/docs/nakama/client-libraries/cocos2d-js/)

### Table of Contents

![](https://static.scarf.sh/a.png?x-pxid=3602d586-1eed-4187-aaeb-70b8018034e2)