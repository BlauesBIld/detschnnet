# Login access and roles

On the first account lookup after deployment, the app automatically adds
`users.login_enabled BOOLEAN NOT NULL DEFAULT FALSE`. All existing accounts start
disabled except the exact username `detschn`, whose stored role becomes `admin`
and whose login remains enabled. New accounts also start disabled. Login choices
are stored in PostgreSQL and survive server restarts; restarting does not disable
accounts that detschn has already enabled.

The application database role must own `users` to perform the initial schema
update (as with the existing Nightbot schema update). The equivalent initialization
SQL for a database administrator is:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET user_role = 'admin', login_enabled = TRUE WHERE username = 'detschn';
```

Log in as detschn at `/streamer/login`, then select **Manage login access** on the
dashboard, or open `/streamer/login-access`. The table shows each account's role
and login status, with an Enable/Disable button for each other user. Only detschn
can access this page or submit changes, including when other admins are enabled.
The form uses a session CSRF token. The owner cannot be disabled, and registration
cannot create another account with the reserved owner name.

The roles defined by the code are:

| Role | Access when login is enabled |
| --- | --- |
| `streamer` | Dashboard and existing connection features |
| `admin` | Streamer features, game administration, account registration, gallery uploads |
| `detschn` (owner, effective `admin`) | All admin features plus exclusive control of login access |

The login access page displays roles currently stored in the database, including
any legacy values. To inspect the database directly:

```sql
SELECT username, user_role, login_enabled FROM users ORDER BY username;
```

Every authenticated request loads the current account using the signed JWT's UUID.
Disabling an account blocks its existing sessions on their next request. Deleted
accounts lose access, and role changes apply immediately. Public pages continue
to work without a logged-in identity for disabled accounts. Database failures
fail authentication rather than granting access from stale JWT claims.

Passwords are stored in `users.password_hash`. Creation uses `bcrypt.hash(password,
10)`, and login uses `bcrypt.compare(password, password_hash)`. To reset a password,
generate a bcrypt hash with the installed Node bcrypt package and update only that
account's `password_hash` using a parameterized query or a SQL string literal.
There is no need for a PostgreSQL extension. Keep actual passwords and reset hashes
out of source control.

## Deployment troubleshooting

If the dashboard shows the new link but `/streamer/login-access` responds with
`Cannot GET`, check for an old Node process: EJS templates are read from disk,
while Express routes are loaded when the process starts. The deployment script
stops both the current `detschnnet` and legacy `detschnet` screen sessions, waits
for port 13061 to be released, and verifies that the new route returns HTTP 401
for an anonymous visitor. Website process output is appended to
`logs/website-startup.log`. The deployment fails if the port remains occupied or
the route check fails.
