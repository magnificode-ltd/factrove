# Factrove CLI

The commands are `upload`, `get`, `share`, and `configure`. Run `factrove --help` for the short list, and `factrove <command> --help` for that command's flags.

```sh
factrove upload ./hey.html
factrove upload ./hey.html --artifactId <artifact-id>
factrove get <artifact-id> --format markdown
factrove share <artifact-id> --password
factrove configure
```

From this repository the same commands run as `pnpm factrove`. pnpm prints the script line it runs to stderr. The program help uses the name `factrove`.

## Commands

`upload <file>` sends one HTML file and creates a new artifact. Plain success prints only the new id and a newline. `--json` prints the `{ artifact }` envelope on one line. `--access private|org_shared` chooses who can see a new artifact. The default is `private`.

`upload <file> --artifactId <id>` replaces that artifact's content and prints the same id. The API keeps the current access and the current share token, so an existing public link serves the new HTML. `--access` together with `--artifactId` is an error. A replace writes a new object and points the artifact at it. Another replace of the same revision receives 409. A later change can keep the previous object as a version.

`get <id>` prints the artifact's content. The default is HTML. `--format markdown` asks the API to convert the stored HTML on the way out. Markdown is not saved. `--json` prints `{ format, mediaType, content }` on one line.

`share <id>` creates a public link, or prints the existing one. `--password` prompts twice on a terminal. `--password-stdin` reads a pipe and removes one trailing newline. `--remove-password` keeps the link and clears its password. `--revoke` removes the link and its password. A Factrove link is `{PUBLIC_BASE_URL}/share/{id}/{token}` and lasts until revoke. It can also carry a password.

`configure` saves an API key and API URL for a profile. `--api-key` prompts when omitted, so the key stays out of shell history. `--api-url` sets the origin, and `--endpoint-url` is the same option. `--profile` selects the profile. The default profile name is `default`.

## Flags

`--api-url <origin>` and `--endpoint-url <origin>` set the API origin for one command. They must be the same value when both are present. `configure` stores that origin as `api_url`.

`--json` and `--output json` print one JSON line. `--output text` is the plain output. `--json` together with `--output text` is an error in either order.

`--profile <name>` is accepted on every command. Help lists it on `configure`. An explicit `--profile` uses that profile's key and ignores `FACTROVE_API_KEY`.

`--quiet` is accepted on `upload`, `get`, and `share`. Help does not list it, and it does not hide their output. `configure` rejects it.

Success exits 0. Failure exits 1.

## Config precedence

The API origin is the first value that is set:

1. `--api-url` or `--endpoint-url`
2. `FACTROVE_API_URL`
3. `FACTROVE_ENDPOINT_URL`, only when `FACTROVE_API_URL` is unset
4. `api_url` in the selected profile
5. `endpoint_url` in that profile, when `api_url` is absent
6. a URL from the dev env file, only for `pnpm factrove`
7. `http://localhost:3001`

The API key is `FACTROVE_API_KEY`, then `factrove_api_key` in the selected profile. An explicit `--profile` skips `FACTROVE_API_KEY` and uses that profile's key. The profile name is `--profile`, then `FACTROVE_PROFILE`, then `default`.

`configure` writes `~/.factrove/credentials` and `~/.factrove/config` with mode 0600. Directories Factrove creates for those files are mode 0700. `FACTROVE_CONFIG_DIR`, `FACTROVE_SHARED_CREDENTIALS_FILE`, and `FACTROVE_CONFIG_FILE` override the paths. The command does not print the key.

## Dev env file

`pnpm factrove` reads `apps/cli/.env`. `node apps/cli/dist/main.js` does not. `FACTROVE_CLI_ENV_FILE` selects a different file, and that name comes from the process environment. The file may set `FACTROVE_API_URL` and `FACTROVE_PROFILE` when those variables are unset. It does not set an API key or `FACTROVE_ENDPOINT_URL`. A URL from the file is used only when the process environment and the selected profile have no URL.

## Differences from aws s3

Factrove stores an artifact id, access, a share link, and the current HTML object key with its size. HTTP responses and the CLI omit the object key. There is no etag and no caller-supplied object metadata. New objects use `{artifactId}/{contentId}.html`. Older rows keep `{artifactId}.html`. The public filename is `{artifactId}.html`.

`aws s3` commands such as `cp`, `ls`, `rm`, `mv`, `sync`, `mb`, and `rb` are not Factrove commands. `aws s3api` commands such as `put-object` and `get-object` take a caller-supplied object key. The CLI addresses an artifact by id and has no `s3api` surface. It uploads a local HTML file and prints or downloads one artifact. It does not copy between two remote locations, and it does not read an upload from stdin.

`share` is the public-link command. An `aws s3 presign` URL is a temporary signed GET and has no password. A Factrove share lasts until `--revoke` and can take a password. The password flags stay on `share`.

`--endpoint-url` is the API origin, the same option as `--api-url`. It is not an S3 endpoint. The API's `S3_ENDPOINT` is server configuration and is not a CLI flag.
