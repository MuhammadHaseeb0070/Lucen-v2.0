-- Default new user_settings rows to Washi theme (app default).
ALTER TABLE user_settings
  ALTER COLUMN active_theme SET DEFAULT 'washi';
