#!/bin/bash

set -exu

# Prepend 'static/' to hardcoded paths for .css and .js files in generated Angular index.html files
# Required due to the deprecation of deployUrl build config option in Angular.
perl -pi -e 's|src="(.*?(\.js)){1}"|src="static/\1"|g' dist/prod/index.html dist/prod-nt/index.html
perl -pi -e 's|href="(.*?(\.css)){1}"|href="static/\1"|g' dist/prod/index.html dist/prod-nt/index.html

mv dist/prod/*.js dist/prod/*.css dist/prod/*.txt dist/prod/static/
mv dist/prod-nt/*.js dist/prod-nt/*.css dist/prod-nt/*.txt dist/prod-nt/static/
