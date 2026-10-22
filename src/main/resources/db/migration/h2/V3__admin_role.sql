-- Admins can open the admin dashboard. The earliest account becomes the first admin.
ALTER TABLE app_users ADD COLUMN admin BOOLEAN DEFAULT FALSE NOT NULL;
UPDATE app_users SET admin = TRUE WHERE id = (SELECT MIN(id) FROM app_users);
