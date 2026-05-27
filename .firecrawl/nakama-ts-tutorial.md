[Home](https://www.vtsxcode.xyz/)Nakama Typescript Server Runtime

Post

Cancel

# Nakama Typescript Server Runtime

Posted _Sep 16, 2022_

By _[VTSxKING](https://twitter.com/username)_

_2 min_ read

> This is not a tutorial nor am I an expert in anything here. I am learning and documenting as I learn. Things here may be wrong, feel free to point them out and reach out to me :)

# Introduction

Nakama instance(s) embeds Javascript virtual machines with in the itself and allows developers to load and run server side code. The documentation for this project is up to date but the proccess varies from system to system, so here is how I was able to load custom server code on my nakama instance. I will mainly be copying and pasting from the existing [example](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/). If you need to install nodejs on your linux distro I recommend the following [article](https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-ubuntu-20-04) to help

# Prerequisites

- Node v14+ LTS, I recommend Node v16.17.0 or greater

# Init

Create Project folder

`    mkdir -p nakama-project/{src,build}
    cd nakama-project

`

initialize with node and get dependencies

`    npm init -y
    npm install --save-dev typescript

`

initialize Typescript compiler

`    npx tsc --init

`

edit the newly created tsconfig.json to look like the following

`{
"files": [\
    "./main.ts",\
    "./healthcheck.ts"\
],
"compilerOptions": {
    "target": "ES5",
    "typeRoots": [\
      "./node_modules"\
    ],
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "outFile": "./build/index.js",
}
}

`

Add nakama runtime dependencies

`    npm i 'https://github.com/heroiclabs/nakama-common'

`

create the `main.ts` file `src` directory

`    nano src/main.ts

`

paste in or type your `Initmodule` typescript code

`function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
    initializer.registerRpc('healthcheck', rpcHealthcheck);
    logger.info('TypeScript module loaded.');
}

`

create the `rpcHealthcheck.ts` file `src` directory

`    nano src/rpcHealthcheck.ts

`

paste in or type your `Initmodule` typescript code

`function rpcHealthcheck(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    logger.info('healthcheck rpc called');
    return JSON.stringify({success: true});
}

`

To compile the typescript

`    npx tsc

`

# Docker

create your docker file

`FROM node:alpine AS node-builder

WORKDIR /backend

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY /src/*.ts ./
RUN npx tsc

FROM heroiclabs/nakama

COPY --from=node-builder /backend/build/*.js /nakama/data/modules/build/
COPY local.yml /nakama/data/

`

create your compose yaml file

`version: '3'
services:
postgres:
    command: postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all
    environment:
      - POSTGRES_DB=nakama
      - POSTGRES_PASSWORD=localdb
    expose:
      - "8080"
      - "5432"
    image: postgres:12.2-alpine
    ports:
      - "5432:5432"
      - "8080:8080"
    volumes:
      - data:/var/lib/postgresql/data

nakama:
    build: .
    depends_on:
      - postgres
    entrypoint:
      - "/bin/sh"
      - "-ecx"
      - >
        /nakama/nakama migrate up --database.address postgres:localdb@postgres:5432/nakama &&
        exec /nakama/nakama --config /nakama/data/local.yml --database.address postgres:localdb@postgres:5432/nakama
    expose:
      - "7349"
      - "7350"
      - "7351"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7350/"]
      interval: 10s
      timeout: 5s
      retries: 5
    links:
      - "postgres:db"
    ports:
      - "7349:7349"
      - "7350:7350"
      - "7351:7351"
    restart: unless-stopped

volumes:
data:

`

# Run

To start our nakama container

`    docker-compose up

`

[gamedev](https://www.vtsxcode.xyz/categories/gamedev/)

[nakama](https://www.vtsxcode.xyz/tags/nakama/) [gamedev](https://www.vtsxcode.xyz/tags/gamedev/)

This post is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) by the author.

Share

Recently Updated

- [Nakama Authoritative Multiplayer](https://www.vtsxcode.xyz/posts/Nakama-Authoritative-Multiplayer/)
- [VTSxCOIN Pt.1](https://www.vtsxcode.xyz/posts/VTSxCOIN/)
- [Algorithms](https://www.vtsxcode.xyz/posts/Algorithms/)
- [Cardano Wallet Authentication For Nakama Server](https://www.vtsxcode.xyz/posts/Wallet-Nakama/)
- [Playcanvas Drag and Drop](https://www.vtsxcode.xyz/posts/Playcanvas-Drag-and-Drop/)

Trending Tags

[gamedev](https://www.vtsxcode.xyz/tags/gamedev/) [playcanvas](https://www.vtsxcode.xyz/tags/playcanvas/) [nakama](https://www.vtsxcode.xyz/tags/nakama/) [crypto](https://www.vtsxcode.xyz/tags/crypto/) [algorithms](https://www.vtsxcode.xyz/tags/algorithms/) [misc](https://www.vtsxcode.xyz/tags/misc/)

### Further Reading

[_Oct 30, 2022_  **Nakama Authoritative Multiplayer**\\
\\
This page is being deprecated, more concise and up to date information can be found here This is not a tutorial nor am I an expert in anything here. I am learning and documenting as I learn....](https://www.vtsxcode.xyz/posts/Nakama-Authoritative-Multiplayer/)

[_Nov 16, 2022_  **Simple Nakama Multiplayer**\\
\\
This is not a tutorial nor am I an expert in anything here. I am learning and documenting as I learn. Things here may be wrong, feel free to point them out and reach out to me :) Introduction ...](https://www.vtsxcode.xyz/posts/Simple-Nakama-Multiplayer/)

[_Aug 27, 2022_  **Cardano Wallet Authentication For Nakama Server**\\
\\
This is not a tutorial nor am I an expert in anything here. I am learning and documenting as I learn. Things here may be wrong, feel free to point them out and reach out to me :) Introduction ...](https://www.vtsxcode.xyz/posts/Wallet-Nakama/)

[Simple Character Controller](https://www.vtsxcode.xyz/posts/Simple-Character-Controller/) [Nakama Authoritative Multiplayer](https://www.vtsxcode.xyz/posts/Nakama-Authoritative-Multiplayer/)

Trending Tags

[gamedev](https://www.vtsxcode.xyz/tags/gamedev/) [playcanvas](https://www.vtsxcode.xyz/tags/playcanvas/) [nakama](https://www.vtsxcode.xyz/tags/nakama/) [crypto](https://www.vtsxcode.xyz/tags/crypto/) [algorithms](https://www.vtsxcode.xyz/tags/algorithms/) [misc](https://www.vtsxcode.xyz/tags/misc/)

 [back-to-top](https://www.vtsxcode.xyz/posts/Nakama-Typescript-Server-Runtime/#)

×

A new version of content is available.

Update