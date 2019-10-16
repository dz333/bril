#!/bin/sh
NAME=$1
brildom < $NAME.json > $NAME.dot && dot -Tps $NAME.dot -o $NAME.ps