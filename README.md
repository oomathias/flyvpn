# 🛸 flyvpn

Ephemeral Tailscale VPN with Fly.io.

Spin up a VPN in a few seconds across 17 regions.

## Why

`flyvpn` is for occasional VPN use if you want to stay away from free VPNs and do not trust mass-market providers.

Go use Mullvad past $5/€5 a month.

https://github.com/user-attachments/assets/cb4662af-c52e-4d40-be69-a59b5cde4119

## What it does

`bun run up`:

- lists the available Fly.io regions
- creates or reuses a Tailscale exit node
- selects the exit node on your Mac
- removes old `flyvpn-*` apps when you change regions

`bun run down` clears the local exit node and destroys all `flyvpn-*` apps.

## Prerequisites

Install and configure these tools:

- [Bun](https://bun.sh/)
- [flyctl](https://fly.io/docs/flyctl/install/), signed in to Fly.io
- [Tailscale](https://tailscale.com/download), connected to your tailnet

You also need a Tailscale auth key.

## Configure your tailnet

Add `tag:vpn` to your [tailnet policy file](https://tailscale.com/docs/reference/syntax/policy-file):

```json
{
  "tagOwners": {
    "tag:vpn": ["autogroup:admin"]
  },
  "autoApprovers": {
    "exitNode": ["tag:vpn"]
  }
}
```

Merge these entries with any existing `tagOwners` and `autoApprovers` entries.

Create a Tailscale auth key with these options:

- **Reusable**
- **Ephemeral**
- **Pre-approved**, if your tailnet requires device approval
- `tag:vpn`

See [Set up a server on your Tailscale network](https://tailscale.com/docs/how-to/set-up-servers) for auth key details.

## Start the VPN

Clone the repository:

```sh
git clone https://github.com/m7b-io/flyvpn.git
cd flyvpn
```

Set the auth key:

```sh
export TS_AUTHKEY=tskey-auth-...
```

Start the VPN:

```sh
bun run up
```

Select a region. `flyvpn` creates the exit node and selects it in Tailscale.

If the exit node does not appear within 60 seconds, approve it in the Tailscale admin console. Then run the command shown by `flyvpn`.

## Stop the VPN

```sh
bun run down
```

This command destroys every Fly.io app whose name starts with `flyvpn-`. Do not use that prefix for other apps.

## License

`flyvpn` uses the [MIT License](LICENSE).
