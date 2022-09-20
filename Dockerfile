FROM osgeo/gdal:ubuntu-small-latest

USER root

ENV DEBIAN_FRONTEND=noninteractive 

RUN apt-get update && apt-get install -y wget g++ gfortran make cdo \
    && rm -rf /var/lib/apt/lists/*

COPY ./build_wgrib.sh /
RUN /build_wgrib.sh

ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION 16.17.0

RUN mkdir -p $NVM_DIR
# install nvm
# https://github.com/creationix/nvm#install-script
RUN curl --silent -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default
# add node and npm to path so the commands are available
ENV NODE_PATH $NVM_DIR/v$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH

ENV NAME fdi

RUN mkdir -p /opt/$NAME
COPY package.json /opt/$NAME/package.json
COPY package-lock.json /opt/$NAME/package-lock.json
RUN cd /opt/$NAME && npm i

WORKDIR /opt/$NAME

COPY . /opt/$NAME/app