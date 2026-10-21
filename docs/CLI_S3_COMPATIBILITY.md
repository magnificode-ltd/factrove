# CLI commands and aws s3 names

Factrove uses the high-level `aws s3` command shape. `cp` is the name for sending a local HTML file and for copying stored bytes back. `aws s3api` names such as `put-object` and `get-object` describe object keys, etags, and metadata Factrove does not store, so the CLI does not use them.

`factrove s3 cp` is the same command as `factrove cp`. `factrove s3` accepts `cp` only. `factrove s3 help` shows help.

`upload` and `get` remain as aliases. A successful alias keeps the original stdout and stderr.

`share` stays `share`. An `aws s3 presign` URL is a temporary signed GET and has no password. A Factrove share link is the public URL `{PUBLIC_BASE_URL}/share/{id}/{token}` and lasts until `factrove share <id> --revoke`. It can also carry a password. `--password` prompts twice without echoing and compares the NFC-normalised confirmation. `--password-stdin` reads a pipe and removes one trailing newline. `--remove-password` keeps the link and clears the password. A protected link says to revoke, then share again, if visitors are locked out. Those flags stay on `share`. They are not `aws s3` flags, and `cp` does not accept them. `--quiet` does not hide share output. Renaming `share` to `presign` would imply an expiry the API does not have.

Commands the CLI did not already have are not added. That includes list, delete, presign, sync, mv, mb, and rb.

## Command mapping

| Old command | S3-style command | Note |
| --- | --- | --- |
| `upload <path>` | `cp <path> factrove://mine/` or `cp <path> factrove://org/[name.html]` | `mine` uploads are private. `org` uploads are `org_shared`. Text output is `upload: <path> to factrove://<scope>/<id>`. `upload` still prints only the viewer URL. |
| `get <id>` | `cp factrove://mine/<id> -` or `cp factrove://org/<id>[.html] <path>` | `-` writes the bytes to stdout and `download: factrove://<scope>/<id> to -` to stderr. A file destination writes the bytes and prints `download: ... to <path>` on stdout. `get` still prints only the content. |
| `share <id>` | `share <id>` | Kept, including `--password`, `--password-stdin`, `--remove-password`, and `--revoke`. `aws s3 presign` is not used. |
| `configure` | `configure` | Saves the profile. `--endpoint-url` is another name for `--api-url` and is stored as `api_url`. |

## Flags

| Old flag | S3-style flag | Note |
| --- | --- | --- |
| `--api-url` | `--endpoint-url` | Both set the API origin. Different values in one command are an error. |
| `--json` | `--output json` | The same JSON payload. `--output text` is the plain output. |
| `--profile` | `--profile` | Unchanged. An explicit profile ignores `FACTROVE_API_KEY`. |
|  | `--quiet` | Hides `cp` upload and download lines. `upload`, `get`, and `share` output stays the same. |

`--format html|markdown` remains on `get` and is also accepted when `cp` copies an artifact out. `--access` remains on `upload`. `cp` takes access from the URI scope.

A download key is the artifact id, or that id plus `.html`. Upload names are not stored. An upload destination may include a `.html` or `.htm` filename, and that name is only the multipart filename. The server assigns the id. Each upload creates a new artifact.

`cp` does not read stdin. `-` is a download destination only. `factrove://mine/` and `factrove://org/` are scopes. A key cannot end with `/`, so `factrove://mine/prefix/` is not a prefix. A directory download saves `<id>.html`, or `<id>.md` when `--format markdown` is set. An explicit file path keeps the name you passed. `--json` together with `--output text` is an error in either order.

`cp` to `-` with `--output json` prints the same `{ format, mediaType, content }` line as `get --json`. `cp` of a local file with `--output json` prints the same `{ artifact }` line as `upload --json`.

Success exits 0. Failure exits 1. The separate AWS CLI codes 2, 130, and 255 are not used.

Origin precedence is `--endpoint-url` or `--api-url`, then `FACTROVE_API_URL`, then `FACTROVE_ENDPOINT_URL`, then the profile `api_url`, then the profile `endpoint_url`, then a URL from `apps/cli/.env` when the command is `pnpm factrove`, then `http://localhost:3001`. `FACTROVE_ENDPOINT_URL` applies only when `FACTROVE_API_URL` is unset. The dev file does not set it.
