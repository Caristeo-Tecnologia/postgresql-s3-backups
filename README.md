# Postgres S3 backups

## Parâmetros

### Common Configuration

```env
# Run backup immediately on startup
RUN_ON_STARTUP=true

# Cron expression for scheduled backups
# Examples:
# - Every minute: * * * * *
# - Every hour: 0 * * * *
# - Every day at 2 AM: 0 2 * * *
# - Every Sunday at 3 AM: 0 3 * * 0
CRON_JOB_INTERVAL=0 2 * * *

# PostgreSQL database connection URL
BACKUP_DATABASE_URL=postgresql://user:password@localhost:5432/dbname

# Optional: URL to download files backup (zip file)
FILES_BACKUP_URL=https://example.com/files-backup.zip

# Path to pg_dump binary (include trailing slash)
PG_DUMP_PATH=/usr/bin/
```

### Storage Provider (AWS S3 or Cloudflare R2)

```env
# Use 'aws' for AWS S3 (default) or 'r2' for Cloudflare R2
STORAGE_PROVIDER=aws
```

### AWS S3 Configuration

Use these variables when `STORAGE_PROVIDER=aws`:

```env
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_S3_BUCKET=my-backup-bucket
AWS_S3_REGION=us-east-1
```

### Cloudflare R2 Configuration

Use these variables when `STORAGE_PROVIDER=r2`:

```env
R2_ACCOUNT_ID=a1b2c3d4e5f6g7h8i9j0
R2_ACCESS_KEY_ID=1234567890abcdef1234567890abcdef
R2_SECRET_ACCESS_KEY=abcdef1234567890abcdef1234567890abcdef12
R2_BUCKET=my-backup-bucket
```

## Example Configurations

### Example 1: AWS S3 with Daily Backups

```env
RUN_ON_STARTUP=false
CRON_JOB_INTERVAL=0 2 * * *
BACKUP_DATABASE_URL=postgresql://myuser:mypass@db.example.com:5432/production
PG_DUMP_PATH=/usr/bin/

STORAGE_PROVIDER=aws
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_S3_BUCKET=prod-backups
AWS_S3_REGION=us-west-2
```

### Example 2: Cloudflare R2 with Hourly Backups

```env
RUN_ON_STARTUP=true
CRON_JOB_INTERVAL=0 * * * *
BACKUP_DATABASE_URL=postgresql://admin:secret@localhost:5432/myapp
FILES_BACKUP_URL=https://myapp.com/api/backup/files
PG_DUMP_PATH=/opt/homebrew/bin/

STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=a1b2c3d4e5f6g7h8i9j0
R2_ACCESS_KEY_ID=1234567890abcdef1234567890abcdef
R2_SECRET_ACCESS_KEY=abcdef1234567890abcdef1234567890abcdef12
R2_BUCKET=myapp-backups
```