#!/usr/bin/env bash
set -eux
set -o pipefail

cd $(dirname ${BASH_SOURCE[0]})/../..

rsync --archive --verbose --exclude=.git ./neuroflag/ ./
rm -f ./.find-ignore
(cd ./external/camera_engine_rkaiq && git lfs fetch && git lfs checkout)
