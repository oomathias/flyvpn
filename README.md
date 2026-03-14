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

## Set up the `TS_AUTHKEY` environment variable

Create a tagged auth key in the Tailscale admin:

- `Reusable`
- `Ephemeral`
- `Pre-approved`
- tag: `tag:vpn`

Then add an ACL so nodes authenticated with that tag can auto-approve exit-node advertising:

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

That lets new `flyvpn-*` nodes come up already tagged and approved as exit nodes instead of waiting for manual approval.

## Store `TS_AUTHKEY` (optional)

This repo can use Fnox to conveniently store the secret.

Fnox:

```sh
fnox set TS_AUTHKEY tskey-auth-...
```

Environment variable:

```sh
export TS_AUTHKEY=tskey-auth-...
```

## Usage

Commands:

```sh
bun run up
bun run down
```

## Fly regions

| Code  | Region                       |
| ----- | ---------------------------- |
| `ams` | Amsterdam, Netherlands       |
| `arn` | Stockholm, Sweden            |
| `bom` | Mumbai, India                |
| `cdg` | Paris, France                |
| `dfw` | Dallas, Texas (US)           |
| `ewr` | Secaucus, NJ (US)            |
| `fra` | Frankfurt, Germany           |
| `gru` | Sao Paulo, Brazil            |
| `iad` | Ashburn, Virginia (US)       |
| `jnb` | Johannesburg, South Africa   |
| `lax` | Los Angeles, California (US) |
| `lhr` | London, United Kingdom       |
| `nrt` | Tokyo, Japan                 |
| `ord` | Chicago, Illinois (US)       |
| `sin` | Singapore, Singapore         |
| `sjc` | San Jose, California (US)    |
| `syd` | Sydney, Australia            |
| `yyz` | Toronto, Canada              |

## Notes

- `up` waits for the new node to appear in your tailnet, then sets your local client to use it as the exit node.
- `down` clears your local exit node first, logs out the remote Tailscale node, then destroys all Fly apps whose names start with `flyvpn-`.
