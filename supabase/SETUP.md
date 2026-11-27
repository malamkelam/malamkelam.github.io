# Multiplayer setup

The GitHub Pages site is static, so online accounts and live rooms need a Supabase project.

1. Create a Supabase project and run [`schema.sql`](./schema.sql) in its SQL Editor.
2. In **Authentication → Providers**, enable the Email provider and **Anonymous Sign-Ins**.
3. In **Authentication → Settings**, turn off email confirmation and set the minimum password length to 8. Accounts use a username and password without collecting an email address.
4. Put the project URL and the public anon/publishable key in [`supabase-config.js`](../supabase-config.js).
5. Commit and push the config change to publish it. Never put a `service_role` or secret key in this file.

Supabase Auth stores and verifies passwords. The room table is protected by row-level security; its RPC functions limit room access to its two players and serialize turns. This is casual online play, not a server-verified competitive chess service.

Username/password accounts use reserved `.invalid` email aliases so usernames can be used to sign in without collecting email addresses. Password reset by email is therefore unavailable. Guests use Supabase anonymous authentication and keep their guest identity in that browser session.
