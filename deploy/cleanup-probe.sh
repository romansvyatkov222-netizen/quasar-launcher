#!/usr/bin/env bash
su - postgres -c 'psql quasar -c "DELETE FROM users WHERE username='"'"'testprobe1'"'"';"'
