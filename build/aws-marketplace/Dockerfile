ARG VERSION=latest
FROM heroiclabs/nakama:$VERSION

#cannot use s3cmd because it's not an official aws tool and doesn't support standard aws credential chain
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
RUN ./aws/install

#install psql for setup
RUN apt-get update -y
RUN apt-get install -y postgresql-client

COPY ./build/aws-marketplace/setup.sh /setup.sh
COPY ./build/aws-marketplace/start.sh /start.sh
RUN chmod a+x /start.sh
ENTRYPOINT [ "/start.sh" ]
