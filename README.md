# 🛸 flyvpn

Ephemeral Tailscale VPN with Fly.io.

Spin up a VPN in a few seconds across 17 regions.

## Why

`flyvpn` is for occasional VPN use if you want to stay away from free VPNs and do not trust mass-market providers.

Go use Mullvad past $5/€5 a month.

https://github.com/user-attachments/assets/cb4662af-c52e-4d40-be69-a59b5cde4119

## What it does

- lists Fly regions and lets you pick one interactively
- creates a new Fly app prefixed with `flyvpn-`
- deploys the official `tailscale/tailscale:stable` image on Fly
- switches your local Tailscale client to that new exit node
- destroys every `flyvpn-*` Fly app with one cleanup command

## Prerequisites

- `bun` installed locally
- `fly` authenticated against your account
- `tailscale` installed and already connected locally
- a Tailscale auth key available as `TS_AUTHKEY`

Fly.io bills started Machines by usage. See [Fly.io billing](https://fly.io/docs/about/billing/) before you create an exit node.

## Configure your tailnet

Add `tag:vpn` to your [tailnet policy file](https://tailscale.com/docs/reference/syntax/policy-file). Merge these entries with any existing `tagOwners` and `autoApprovers` sections:

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

Create a Tailscale auth key with these settings:

- **Reusable**
- **Ephemeral**
- **Pre-approved**, if your tailnet uses device approval
- `tag:vpn`

The tag lets Tailscale approve each new exit node without a second admin action. See [Set up a server on your Tailscale network](https://tailscale.com/docs/how-to/set-up-servers) for the auth-key options.

## Start the VPN

Clone the repository and open its directory:

```sh
git clone https://github.com/m7b-io/flyvpn.git
cd flyvpn
```

Set the auth key for the current shell:

```sh
export TS_AUTHKEY=tskey-auth-...
```

Then start the exit node:

```sh
bun run up
```

Choose a region from the list. `flyvpn` creates an app named `flyvpn-<region>-<suffix>` and deploys the official `tailscale/tailscale:stable` image. It then selects the new exit node.

If an app already exists for the selected region, `flyvpn` reuses it. It removes any other Fly apps whose names start with `flyvpn-`.

If the node does not appear in your tailnet within 60 seconds, the command prints the manual `tailscale set` command.

## Stop the VPN

Run:

```sh
bun run down
```

This command tries to clear the local exit node and log out the remote Tailscale nodes. It then destroys every visible Fly app whose name starts with `flyvpn-`.

Do not use the `flyvpn-` prefix for Fly apps that this tool must preserve.

## License

`flyvpn` is available under the [MIT License](LICENSE).
