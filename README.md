# Postgres S3 backups

## Parâmetros

RUN_ON_STARTUP=true
CRON_JOB_INTERVAL=* * * * *
BACKUP_DATABASE_URL=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=...
AWS_S3_REGION=...
PG_DUMP_PATH=...