# Database Backup System

Automated backup system supporting PostgreSQL and MSSQL databases, with file backups to AWS S3, Cloudflare R2, or local storage.

## Features

- ✅ **Multiple Database Support**: Backup PostgreSQL and MSSQL databases
- ✅ **Multi-Database Configuration**: Configure multiple databases of the same or different types
- ✅ **Flexible Storage**: Support for AWS S3, Cloudflare R2, or local directory
- ✅ **Scheduled Backups**: Use cron expressions for automated backups
- ✅ **File Backups**: Backup files from local directories or URLs
- ✅ **Backward Compatible**: Supports legacy single-database configuration

## Configuration

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
```

### Backup Storage Configuration

Choose where to store your backups:

```env
# Storage mode: 'cloud' (S3/R2) or 'local' (local directory)
# Default: 'cloud'
BACKUP_STORAGE=cloud

# If BACKUP_STORAGE=local, specify the local backup directory
# This path will contain subdirectories: db-backup/ and files-backup/
LOCAL_BACKUP_PATH=/path/to/backup/folder
```

### Database Configuration

#### New Format: Multiple Databases (Recommended)

Configure multiple databases using a JSON array in `DATABASE_CONFIGS`:

```env
DATABASE_CONFIGS='[
  {
    "type": "postgresql",
    "name": "my_postgres_db",
    "connectionString": "postgresql://user:password@localhost:5432/dbname"
  },
  {
    "type": "mssql",
    "name": "my_mssql_db",
    "host": "localhost",
    "port": 1433,
    "database": "dbname",
    "user": "sa",
    "password": "YourPassword123",
    "options": {
      "encrypt": true,
      "trustServerCertificate": true
    }
  }
]'
```

**PostgreSQL Configuration Fields:**
- `type`: Must be `"postgresql"`
- `name`: Friendly name for the database (used in backup filename)
- `connectionString`: Full PostgreSQL connection URL

**MSSQL Configuration Fields:**
- `type`: Must be `"mssql"`
- `name`: Friendly name for the database (used in backup filename)
- `host`: Database server hostname or IP
- `port`: Port number (default: 1433)
- `database`: Database name
- `user`: Database user
- `password`: Database password
- `options` (optional):
  - `encrypt`: Enable encryption (default: true)
  - `trustServerCertificate`: Trust self-signed certificates (default: false)

#### Legacy Format: Single Database (Still Supported)

For backward compatibility, you can still use the legacy format:

```env
BACKUP_DATABASE_URL=postgresql://user:password@localhost:5432/dbname
PG_DUMP_PATH=/usr/bin/
```

### Files Backup Configuration

```env
# Option 1: Local directory path
FILES_BACKUP_PATH=/path/to/files/

# Option 2: URL to download files backup (zip file)
FILES_BACKUP_URL=https://example.com/files-backup.zip
```

### PostgreSQL Tools Path

```env
# Path to pg_dump binary (include trailing slash)
# Required for PostgreSQL backups

# Linux/macOS:
PG_DUMP_PATH=/usr/bin/
# or
# PG_DUMP_PATH=/opt/homebrew/bin/

# Windows:
# PG_DUMP_PATH=C:\Program Files\PostgreSQL\17\bin\
# or leave empty if pg_dump is in system PATH
# PG_DUMP_PATH=
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

### Example 1: Local Backup (No Cloud Storage)

Save all backups to a local directory without uploading to S3/R2:

```env
RUN_ON_STARTUP=true
CRON_JOB_INTERVAL=0 2 * * *
PG_DUMP_PATH=/usr/bin/

# Local storage configuration
BACKUP_STORAGE=local
LOCAL_BACKUP_PATH=/backup/directory

DATABASE_CONFIGS='[
  {
    "type": "postgresql",
    "name": "production_db",
    "connectionString": "postgresql://user:pass@localhost:5432/prod"
  },
  {
    "type": "mssql",
    "name": "crm_db",
    "host": "localhost",
    "port": 1433,
    "database": "CRM",
    "user": "sa",
    "password": "Password123"
  }
]'

FILES_BACKUP_PATH=/var/www/uploads/
```

### Example 2: Multiple PostgreSQL Databases with AWS S3

```env
RUN_ON_STARTUP=false
CRON_JOB_INTERVAL=0 2 * * *
PG_DUMP_PATH=/usr/bin/

# Cloud storage configuration
BACKUP_STORAGE=cloud

DATABASE_CONFIGS='[
  {
    "type": "postgresql",
    "name": "production_db",
    "connectionString": "postgresql://user:pass@db1.example.com:5432/prod"
  },
  {
    "type": "postgresql",
    "name": "staging_db",
    "connectionString": "postgresql://user:pass@db2.example.com:5432/staging"
  }
]'

STORAGE_PROVIDER=aws
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_S3_BUCKET=prod-backups
AWS_S3_REGION=us-west-2
```

### Example 3: Mixed PostgreSQL and MSSQL with Cloudflare R2

```env
RUN_ON_STARTUP=true
CRON_JOB_INTERVAL=0 3 * * *
PG_DUMP_PATH=/opt/homebrew/bin/

# Cloud storage configuration
BACKUP_STORAGE=cloud

DATABASE_CONFIGS='[
  {
    "type": "postgresql",
    "name": "app_db",
    "connectionString": "postgresql://admin:secret@localhost:5432/myapp"
  },
  {
    "type": "mssql",
    "name": "crm_db",
    "host": "mssql.example.com",
    "port": 1433,
    "database": "CRM",
    "user": "sa",
    "password": "StrongPassword123",
    "options": {
      "encrypt": true,
      "trustServerCertificate": false
    }
  }
]'

FILES_BACKUP_PATH=/var/www/uploads/

STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=a1b2c3d4e5f6g7h8i9j0
R2_ACCESS_KEY_ID=1234567890abcdef1234567890abcdef
R2_SECRET_ACCESS_KEY=abcdef1234567890abcdef1234567890abcdef12
R2_BUCKET=myapp-backups
```

### Example 4: Multiple MSSQL Databases

```env
RUN_ON_STARTUP=true
CRON_JOB_INTERVAL=0 * * * *

# Cloud storage configuration
BACKUP_STORAGE=cloud

DATABASE_CONFIGS='[
  {
    "type": "mssql",
    "name": "customers_db",
    "host": "localhost",
    "port": 1433,
    "database": "Customers",
    "user": "sa",
    "password": "Password123"
  },
  {
    "type": "mssql",
    "name": "orders_db",
    "host": "localhost",
    "port": 1433,
    "database": "Orders",
    "user": "sa",
    "password": "Password123"
  }
]'

STORAGE_PROVIDER=aws
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_S3_BUCKET=mssql-backups
AWS_S3_REGION=us-east-1
```

### Example 5: Legacy Single Database (Backward Compatible)

```env
RUN_ON_STARTUP=false
CRON_JOB_INTERVAL=0 2 * * *
BACKUP_DATABASE_URL=postgresql://myuser:mypass@db.example.com:5432/production
PG_DUMP_PATH=/usr/bin/

# Cloud storage configuration
BACKUP_STORAGE=cloud

STORAGE_PROVIDER=aws
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_S3_BUCKET=prod-backups
AWS_S3_REGION=us-west-2
```

## Installation & Usage

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and configure your settings

3. Run the backup system:
```bash
npm start
```

4. Build for production:
```bash
npm run build
```

## Backup Files

### Cloud Storage (BACKUP_STORAGE=cloud)
- Database backups are uploaded to the `db-backup/` folder in your S3/R2 bucket
- Files backups are uploaded to the `files-backup/` folder
- Local backup files are automatically cleaned up after successful upload

### Local Storage (BACKUP_STORAGE=local)
- Database backups are saved directly in the `LOCAL_BACKUP_PATH` directory
- Files backups are saved in `LOCAL_BACKUP_PATH/files-backup/`
- Local files are preserved (not deleted after backup)

**Backup Filename Formats:**
- PostgreSQL: `backup-{name}-{timestamp}.sql.gz` (gzip compressed)
- MSSQL: `backup-{name}-{timestamp}.bak` (SQL file)

## Requirements

- Node.js 16+
- PostgreSQL client tools (pg_dump) for PostgreSQL backups
  - **Windows**: Install PostgreSQL and add `bin` directory to PATH or set `PG_DUMP_PATH`
  - **Linux/macOS**: Install `postgresql-client` package or full PostgreSQL
  - **Windows**: Requires gzip (included with Git for Windows or install separately)
- Network access to MSSQL servers for MSSQL backups
- Write permissions to `LOCAL_BACKUP_PATH` if using local storage

## Platform Support

✅ **Windows** - Fully supported (Windows 10/11, Windows Server)
✅ **macOS** - Fully supported
✅ **Linux** - Fully supported

## Notes

- MSSQL backups are created by connecting directly to the database and exporting data as SQL INSERT statements
- PostgreSQL backups use the native `pg_dump` tool for maximum compatibility and performance
- The system validates all database configurations before attempting backups
- Failed backups for individual databases won't stop the backup process for other databases
- When using local storage, backups are preserved and not deleted (make sure you have enough disk space)
- When using cloud storage, local temporary files are automatically cleaned up after successful upload