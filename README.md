# Hookbase Setup Tunnel — GitHub Action

Expose a localhost port via a [Hookbase](https://www.hookbase.app) tunnel for webhook integration testing in CI. Use it to receive real webhooks from Stripe, GitHub, Shopify, or any other provider against an ephemeral CI environment.

## Usage

```yaml
- uses: hookbase/setup-tunnel@v1
  id: tunnel
  with:
    port: 3000
    api-key: ${{ secrets.HOOKBASE_API_KEY }}

- run: echo "Webhook URL is ${{ steps.tunnel.outputs.tunnel-url }}"
```

The tunnel is automatically torn down when the job finishes.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `port` | yes | — | Local port to forward to the tunnel. |
| `api-key` | yes | — | Hookbase API key (`whr_...`). Use a repo or org secret. |
| `subdomain` | no | — | Custom subdomain for the tunnel (Pro plan). |
| `cli-version` | no | `latest` | Version of `@hookbase/cli` to install. |
| `api-url` | no | `https://api.hookbase.app` | Override the Hookbase API URL. |
| `ready-timeout-ms` | no | `30000` | How long to wait for the tunnel to connect before failing. |

## Outputs

| Output | Description |
|--------|-------------|
| `tunnel-url` | Public URL of the tunnel. Also exported as the `HOOKBASE_TUNNEL_URL` env var. |

## Example: end-to-end Stripe webhook test

```yaml
jobs:
  webhook-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci

      - name: Start app server
        run: npm run start &

      - uses: hookbase/setup-tunnel@v1
        id: tunnel
        with:
          port: 3000
          api-key: ${{ secrets.HOOKBASE_API_KEY }}

      - name: Trigger Stripe test event to tunnel
        env:
          STRIPE_API_KEY: ${{ secrets.STRIPE_TEST_KEY }}
        run: |
          curl -sS https://api.stripe.com/v1/webhook_endpoints \
            -u "$STRIPE_API_KEY:" \
            -d "url=${{ steps.tunnel.outputs.tunnel-url }}" \
            -d "enabled_events[]=checkout.session.completed"
          # ...trigger the test event...
```

## Example: GitHub webhook test

```yaml
- uses: hookbase/setup-tunnel@v1
  id: tunnel
  with:
    port: 8080
    api-key: ${{ secrets.HOOKBASE_API_KEY }}

- name: Register GitHub webhook
  run: |
    gh api repos/${{ github.repository }}/hooks \
      -f name=web \
      -f config[url]=${{ steps.tunnel.outputs.tunnel-url }} \
      -f config[content_type]=json \
      -f events[]=push
```

## How it works

1. Installs `@hookbase/cli` globally on the runner.
2. Authenticates via the `HOOKBASE_API_KEY` env var (no interactive login).
3. Starts `hookbase tunnels start <port> --json` as a detached background process.
4. Waits for the `tunnel.connected` event on stdout, parses the public URL, and exposes it as a step output.
5. On job teardown, sends `SIGTERM` to the CLI, which deletes the tunnel server-side.

## License

MIT
