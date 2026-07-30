import crypto from 'crypto';

// Standard username used for the read-only user auto-provisioned when the
// configured database user turns out to have write permissions.
export const READONLY_BACKUP_USERNAME = 'backup_readonly_user';

export const generateRandomPassword = (): string => crypto.randomBytes(24).toString('base64url');
