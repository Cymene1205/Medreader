#!/bin/bash
# Double-fork daemon pattern
cd /home/z/my-project
rm -f /home/z/my-project/dev-start.log /home/z/my-project/dev.log

# First fork
(
  # Second fork
  (
    exec npm run dev > /home/z/my-project/dev-start.log 2>&1
  ) &
) &

# Give it a moment
sleep 1
echo "Daemon started"
