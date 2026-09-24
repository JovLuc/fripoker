#!/bin/sh
# fripoker runtime entry. The build copies this into dist/start.sh, so the
# dist/ folder stays relocatable: run it from anywhere, rename the folder,
# or ship it with node_modules — paths resolve relative to the script itself.
# No env presets here; every default lives in src/server/config.ts
# (PORT 3000, BASE_PATH /fpk, HOST 0.0.0.0, cheats on — room-page toggle).
set -eu
export BASE_PATH=/fpk
export PORT=52006
nohup exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/server/index.js" &> log &
