-- ==============================================================================
-- ⚠️ DANGER: DEVELOPMENT RESET SCRIPT
-- ==============================================================================
-- This script will completely wipe all user data and authentication accounts
-- from your Supabase project. It leaves your tables (schema) and environment
-- variables completely intact.
--
-- USAGE: Run this in the Supabase SQL Editor to get a "fresh start" during dev.
-- ==============================================================================

-- 1. Temporarily disable foreign key constraints and triggers
SET session_replication_role = 'replica';

-- 2. Truncate (empty) all application data tables
TRUNCATE TABLE public.usage_logs CASCADE;
TRUNCATE TABLE public.webhook_events CASCADE;
TRUNCATE TABLE public.credit_ledgers CASCADE;
TRUNCATE TABLE public.user_credits CASCADE;

-- 3. Wipe all Authentication Users
-- This forces you to sign up again like a brand new user.
DELETE FROM auth.users;

-- 4. Re-enable constraints and triggers
SET session_replication_role = 'origin';

-- Done! Your database is now completely empty but fully functional.
