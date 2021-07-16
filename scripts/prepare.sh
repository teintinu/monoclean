#!/usr/bin/env bash

ROOT=`realpath $(dirname $0)/..`
mkdir -p $ROOT/npm
cd $ROOT/npm

node ../scripts/prepare.js $ROOT/npm/package.json

npm install go-npm --save
rm -Rf node_modules