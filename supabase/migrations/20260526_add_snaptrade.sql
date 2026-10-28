-- Migration: Add SnapTrade userSecret column to users table
-- Run in Supabase SQL Editor → New Query
ALTER TABLE users ADD COLUMN IF NOT EXISTS snaptrade_user_secret TEXT;
