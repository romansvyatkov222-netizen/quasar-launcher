#!/usr/bin/env bash
su - postgres -c 'psql quasar -c "SELECT username, created_at FROM users ORDER BY created_at;"'
grep -E "JWT_EXPIRES_IN" /home/quasar-backend/.env
