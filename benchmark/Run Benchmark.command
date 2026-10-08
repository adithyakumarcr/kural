#!/bin/bash
# Double-click in Finder: runs the Kural engine benchmark in Terminal, then opens the report.
cd "$(dirname "$0")" && ./run.sh "$@"
echo
read -r -p "Press Enter to close this window. " _
