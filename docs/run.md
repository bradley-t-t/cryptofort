# Running a command with a credential

`cryptofort run` decrypts the credentials you name into a command's
environment, runs the command, and exits with the command's exit code. Nothing
is printed, so the value never appears on a command line, in shell history, in
a log watching the process table, or in the transcript of an agent that ran it.

It closes the gap the metadata-only MCP server leaves open. An agent can find
_which_ credential a job needs with `credential_search`, and then use it without
ever being handed it:

```bash
cryptofort run --env-file ~/.cryptofort.env stripe-secret-key -- node scripts/refund.js
```

`refund.js` reads `process.env.STRIPE_SECRET_KEY`. The agent sees what the
script prints and nothing else.

## Usage

```
cryptofort run [--namespace <ns>] [--env-file <path>] <credential>[=<ENV_VAR>]... -- <command> [args...]
```

- **`<credential>=<ENV_VAR>`** puts the credential into that variable.
- **`<credential>`** on its own uses the credential's name in upper case, with
  every run of other characters turned into an underscore. `stripe-secret-key`
  becomes `STRIPE_SECRET_KEY`, and `db.url` becomes `DB_URL`.
- **`--namespace <ns>`** (or `-n`) reads every credential from that namespace.
  It defaults to `default`, as `get` does.
- **`--env-file <path>`** reads the vault's configuration from a `NAME=value`
  file. See below.
- **`--`** is required. Everything after it is the command, passed as given,
  with no shell in between.

Several credentials can go to one command:

```bash
cryptofort run -n staging db-url=DATABASE_URL stripe-secret-key -- npm run migrate
```

## Configuring the vault

`cryptofort run` reads the same variables as `cryptofort-mcp`:
`CRYPTOFORT_MASTER_KEY`, `CRYPTOFORT_ADAPTER` and whatever that adapter needs.
[Configuration](configuration.md) lists them.

They can come from this process's environment, or from `--env-file`. The file
is the better home for them, because a master key exported in your shell is
inherited by every process you start from it. The file must be readable by its
owner alone. Anything looser is refused rather than used, because a key other
users could read has to be treated as read:

```bash
chmod 600 ~/.cryptofort.env
```

## What the command gets

The command inherits this process's environment **without** the variables that
open the vault. Every `CRYPTOFORT_*` variable and `SUPABASE_SERVICE_ROLE_KEY` are
removed, and nothing from `--env-file` is passed on. The command gets the
credentials it was named, and nothing it could use to read the others.

A credential you map onto one of those names on purpose is still set, because
the named credentials are applied last. For example,
`app-service-key=SUPABASE_SERVICE_ROLE_KEY` hands your app its own key.

## Failures

`cryptofort run` resolves every credential before it starts the command. If any
one is missing or expired, it names each absent credential and runs nothing.
A command started without a value it was promised fails later and further from
the cause, or falls back to a default such as a local database.

| Exit code         | Meaning                                                     |
| :---------------- | :---------------------------------------------------------- |
| the command's own | The command ran. Its exit code is passed through unchanged. |
| 128 + _n_         | The command was stopped by signal _n_, as a shell reports.  |
| 1                 | A credential was missing, or the vault could not be opened. |
| 2                 | The command line could not be parsed.                       |
| 126               | The command exists but could not be executed.               |
| 127               | The command was not found.                                  |

Ctrl-C reaches the command directly from the terminal, and `cryptofort run`
waits for it to finish. A `SIGTERM` or `SIGHUP` sent to `cryptofort run` alone is
passed on to the command.

## What it does not protect

- **The command can print the value.** `cryptofort run stripe-secret-key -- env`
  prints it, and so does a script that logs its configuration. The value is
  kept off command lines and out of `cryptofort run`'s own output, not out of
  the command's. An agent allowed to choose the command can choose one that
  prints.
- **It runs as you.** Anyone who can read the env file, or your environment, can
  open the vault without it. That includes an agent with a shell running as your
  user. Keeping the key out of config files and transcripts is what this
  changes, not who can reach your files.
- **Child processes inherit the credentials.** Whatever the command starts gets
  its environment, so the value goes as far as the command passes it.
