# CLI

## Purpose

The CLI is a standalone NestJS program that calls the HTTP API. It has no listener, no local artifact index, and no database or storage credentials. The published package is `factrove`. The `ftrv` bin runs the same program. `pnpm factrove` is the checkout command. User setup is [docs/guides/cli.mdx](../docs/guides/cli.mdx).

## Current behavior

The commands are `upload`, `list`, `get`, `share`, `rename`, `delete`, and `configure`.

```sh
factrove configure
factrove upload ./report.html
factrove upload ./report.html --name "X launch calendar" --access org_shared --json
factrove upload ./report.html --artifactId <artifact-id>
factrove get <artifact-id> --format markdown
factrove share <artifact-id> --password
factrove share <artifact-id> --revoke
factrove list --view org --json
factrove rename <artifact-id> --name "X launch calendar"
factrove delete <artifact-id> --yes
```

`upload <file>` creates an artifact. Plain success prints the id and a newline. `--json` prints the `{ artifact }` envelope on one line, including `viewerUrl`. `--access private|org_shared` applies only when creating. The default is `private`. `--artifactId` replaces that artifact's content, prints the same id, and rejects `--access`. `--name` sets the library name on create, replace, or `rename`. Omit it on create and the name is the file stem, under the rules in [artifacts.md](artifacts.md). Omit it on replace and the current name stays. `rename` requires `--name`. There is no flag to clear a name. Plain rename success prints `Renamed {id}.`

`get` writes the content bytes to stdout and does not add a newline. `--format html|markdown` defaults to `html`. JSON get prints `{ format, mediaType, content }`. `list` prints `{id}  {access}  {name}` per line. A null name uses `{id}.html`. An empty list prints nothing. `--view mine|org` defaults to `mine` and is valid only for `list`. JSON list prints `{ items }`.

`share` prints the public URL, whether the link is password protected, and a recovery note when it is. `--revoke` prints `Revoked the public link for {id}.` and does not print the token. `--remove-password` prints `Removed the password for {id}.` JSON share prints `{ share: { shared, shareUrl, passwordProtected } }`. `--password` takes no value: it prompts twice on a terminal without echoing, and fails when stdin is not a terminal. `--password-stdin` reads stdin and removes one trailing newline. A password given as an argument is rejected. Password rules are in [sharing.md](sharing.md). `--revoke`, `--password`, `--password-stdin`, and `--remove-password` are valid only for `share`, and only one of them at a time. The CLI does not add a `presign` command.

`delete` asks for confirmation on a terminal and accepts `--yes` or `--force` to skip it. They mean the same thing. Without one of them, a non-interactive stdin fails. Cancelling the prompt exits 1. Plain success prints `Deleted {id}.` JSON delete prints `{"deleted":true,"id":"…"}` because the HTTP response is empty.

`--output json|text` selects the format. `--json` is `--output json`. `--json` together with `--output text` is an error in either order. `--quiet` is accepted on every command except `configure`, is omitted from help, and does not hide output. `--profile` is accepted on every command and is listed on `configure --help`. Success exits 0. Failure exits 1. Errors go to stderr. In JSON mode the common error envelope goes to stderr. Local codes are `FILE_NOT_FOUND`, `INVALID_INPUT`, and `NETWORK_ERROR`. API errors pass through, including `Retry-After` on a throttled unlock. The process prints no framework startup log on stdout and closes the Nest application context.

`configure` writes the API key and the API URL for a profile. `--api-key` prompts when omitted. The command does not print the key. It writes `~/.factrove/credentials` and `~/.factrove/config` through a mode 0600 temporary file in the same directory and renames that file into place. When the destination is a symlink, the write follows the link and leaves the symlink in place. A symlink loop is `INVALID_INPUT`. Directories Factrove creates for those files are mode 0700. An existing parent directory keeps its mode. `FACTROVE_CONFIG_DIR`, `FACTROVE_SHARED_CREDENTIALS_FILE`, and `FACTROVE_CONFIG_FILE` override the paths. The success line and the terminal URL prompt print the API origin only. A URL with a username, a password, or a credential query parameter is rejected and is not saved.

There are no automatic upload retries. `get` calls the content endpoint once. `upload --artifactId` calls the replace endpoint once.

## Config precedence

The API origin is the first value that is set:

1. `--api-url` or `--endpoint-url`. Both flags are the same option. Different values are an error. `configure` stores the origin as `api_url`.
2. `FACTROVE_API_URL`.
3. `FACTROVE_ENDPOINT_URL`, only when `FACTROVE_API_URL` is unset.
4. `api_url` in the selected profile.
5. `endpoint_url` in that profile, when `api_url` is absent.
6. A URL from the dev env file, only for `pnpm factrove`.
7. `https://api.factrove.app`.

The profile name is `--profile`, then `FACTROVE_PROFILE`, then `default`. The API key is `FACTROVE_API_KEY`, then `factrove_api_key` in the selected profile. An explicit `--profile` skips `FACTROVE_API_KEY` and uses that profile's key.

`pnpm factrove` reads `apps/cli/.env`. `FACTROVE_CLI_ENV_FILE` selects a different file, and that name comes from the process environment. The file may set `FACTROVE_API_URL` and `FACTROVE_PROFILE` when those variables are unset. It does not set an API key, `FACTROVE_ENDPOINT_URL`, or config-path overrides. A URL from the file is used only when the process environment and the selected profile have no URL. The example sets `FACTROVE_API_URL` to `http://localhost:3001`. `node apps/cli/dist/main.js` and the published `factrove` and `ftrv` commands do not read that file. Without a URL from a flag, the environment, a profile, or that dev file, the origin is `https://api.factrove.app`.

## Differences from `aws s3`

Factrove stores an artifact id, a library name, access, a share link, and the current HTML object key with its size. HTTP responses and the CLI omit the object key. There is no etag and no caller-supplied object metadata. New objects use `{artifactId}/{contentId}.html`. Older rows keep `{artifactId}.html`. The public filename is `{artifactId}.html`. The name is a separate field.

`aws s3` commands such as `cp`, `ls`, `rm`, `mv`, `sync`, `mb`, and `rb` are not Factrove commands. Factrove uses `list`, `rename`, and `delete` for those jobs. `aws s3api` commands such as `put-object` and `get-object` take a caller-supplied object key. The CLI addresses an artifact by id and has no `s3api` surface. It uploads a local HTML file, lists artifacts, and prints or downloads one artifact. It does not copy between two remote locations, and it does not read an upload from stdin.

`share` is the public-link command. An `aws s3 presign` URL is a temporary signed GET and has no password. A Factrove share lasts until `--revoke` and can take a password. The password flags stay on `share`.

`--endpoint-url` is the API origin, the same option as `--api-url`. It is not an S3 endpoint. The API's `S3_ENDPOINT` is server configuration and is not a CLI flag.

## Decisions

The key belongs to the organization it was created for. Configure stores that key. It does not choose an organization. Keys created before organization ownership stopped working and are created again in the web app.

Client packages never receive database, storage, or auth-secret credentials.
