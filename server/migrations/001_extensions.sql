-- 001_extensions.sql
-- Enable PostgreSQL extensions required by ALMATRACE.
--
-- uuid-ossp: provides gen_random_uuid() / uuid_generate_v4() for UUID PKs.
-- pgcrypto:  provides gen_random_bytes() and crypt() — used for secure OTP
--            generation and, where needed, additional crypto utilities.
--
-- These extensions must be installed by a superuser (or a role with
-- CREATE EXTENSION privilege). In production this is run by the migration
-- role before the application role is used.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
