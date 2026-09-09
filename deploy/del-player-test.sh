#!/usr/bin/env bash
su - postgres -c 'psql quasar -c "DELETE FROM users WHERE LOWER(username) = '"'"'player_test'"'"';"'
su - postgres -c 'psql quasar -c "SELECT username FROM users;"'
