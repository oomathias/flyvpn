#!/usr/bin/env bun

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

const APP_PREFIX = 'flyvpn-'
const TS_STATE_DIR = '/var/lib/tailscale'
const TS_SOCKET = '/var/run/tailscale/tailscaled.sock'
const EXIT_NODE_WAIT_MS = 60_000
const EXIT_NODE_POLL_MS = 2_000

type Region = {
  code: string
  name: string
}

type ExitNode = {
  hostName: string
  dnsName: string | null
  ips: string[]
}

const command = Bun.argv[2] ?? 'up'

try {
  switch (command) {
    case 'up':
      await up()
      break
    case 'down':
      await down()
      break
    case 'help':
    case '--help':
    case '-h':
      console.log(
        'flyvpn\n\nCommands:\n  up     Create a Fly exit node and use it locally\n  down   Destroy every flyvpn-prefixed Fly app'
      )
      break
    default:
      throw new Error(`Unknown command: ${command}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

function requireCommand(name: string) {
  if (!Bun.which(name)) throw new Error(`Missing required command: ${name}`)
}

async function up() {
  ;['fly', 'tailscale'].forEach(requireCommand)

  const authKey = Bun.env.TS_AUTHKEY?.trim()
  if (!authKey) throw new Error('Set TS_AUTHKEY before running `flyvpn up`.')

  const regions = parseResponseList<{
    code?: string
    Code?: string
    name?: string
    Name?: string
  }>(run(['fly', 'platform', 'regions', '--json']).stdout, 'regions')
    .flatMap((row): Region[] => {
      const code = row.code ?? row.Code
      const name = row.name ?? row.Name
      return code && name ? [{ code, name }] : []
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  if (regions.length === 0) throw new Error('Fly returned no regions.')

  console.log('Available Fly regions:')
  regions.forEach((region, index) => {
    console.log(`${String(index + 1).padStart(2, ' ')}. ${region.code} - ${region.name}`)
  })

  const rl = createInterface({ input, output })
  let region: Region | null = null

  try {
    while (!region) {
      const answer = (await rl.question('Select a region by number: ')).trim()
      const index = Number.parseInt(answer, 10)

      if (Number.isInteger(index) && index >= 1 && index <= regions.length) {
        region = regions[index - 1]
      } else {
        console.log(`Enter a number between 1 and ${regions.length}.`)
      }
    }
  } finally {
    rl.close()
  }

  const appName = `${APP_PREFIX}${region.code}-${Math.random().toString(36).slice(2, 8)}`
  const tempDir = mkdtempSync(join(tmpdir(), 'flyvpn-'))
  const configPath = join(tempDir, 'fly.toml')
  const startupCommand = [
    'set -eu',
    `mkdir -p /var/run/tailscale ${TS_STATE_DIR}`,
    'echo 1 > /proc/sys/net/ipv4/ip_forward',
    'echo 1 > /proc/sys/net/ipv6/conf/all/forwarding',
    'iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE',
    'ip6tables -t nat -A POSTROUTING -o eth0 -j MASQUERADE',
    `/usr/local/bin/tailscaled --statedir=${TS_STATE_DIR} --socket=${TS_SOCKET} --port=41641 & TAILSCALED_PID=$!`,
    `until [ -S ${TS_SOCKET} ]; do sleep 0.1; done`,
    `until /usr/local/bin/tailscale --socket=${TS_SOCKET} up --authkey=\${TS_AUTHKEY} --hostname=\${TS_HOSTNAME} --advertise-exit-node; do sleep 0.1; done`,
    'wait "$TAILSCALED_PID"',
  ].join('; ')

  writeFileSync(
    configPath,
    `app = ${JSON.stringify(appName)}
primary_region = ${JSON.stringify(region.code)}

[build]
  image = "tailscale/tailscale:stable"

[deploy]
  strategy = "immediate"

[env]
  TS_HOSTNAME = ${JSON.stringify(appName)}

[experimental]
  entrypoint = ["/bin/sh", "-lc"]
  cmd = [${JSON.stringify(startupCommand)}]

[[vm]]
  cpu_kind = "shared"
  cpus = 2
  memory_mb = 512
`
  )

  console.log(`Creating ${appName} in ${region.code} (${region.name})...`)

  try {
    await runInherited(['fly', 'apps', 'create', appName])
    await runInherited(['fly', 'secrets', 'set', `TS_AUTHKEY=${authKey}`, '-a', appName, '--stage'])
    await runInherited(
      ['fly', 'deploy', '--ha=false', '--config', configPath, '-a', appName],
      tempDir
    )
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }

  let exitNode: ExitNode | null = null
  const deadline = Date.now() + EXIT_NODE_WAIT_MS

  while (!exitNode) {
    const status = JSON.parse(run(['tailscale', 'status', '--json']).stdout) as {
      Peer?: Record<
        string,
        {
          DNSName?: string
          HostName?: string
          ExitNodeOption?: boolean
          TailscaleIPs?: unknown
        }
      >
    }

    for (const peer of Object.values(status.Peer ?? {})) {
      const dnsName = peer.DNSName?.replace(/\.$/, '') ?? null
      const hostName = peer.HostName ?? null
      const ips = Array.isArray(peer.TailscaleIPs)
        ? peer.TailscaleIPs.filter((ip): ip is string => typeof ip === 'string')
        : []

      if (peer.ExitNodeOption !== true || hostName === null) continue
      if (hostName !== appName && dnsName !== appName && !dnsName?.startsWith(`${appName}.`)) {
        continue
      }

      exitNode = { hostName, dnsName, ips }
      break
    }

    if (exitNode || Date.now() >= deadline) break
    await Bun.sleep(EXIT_NODE_POLL_MS)
  }

  if (!exitNode) {
    console.log('')
    console.log(`Deployed ${appName}, but it did not show up as a selectable exit node within 60s.`)
    console.log('Approve it in the Tailscale admin if needed, then run:')
    console.log(`tailscale set --exit-node=${appName} --exit-node-allow-lan-access=true`)
    return
  }

  const exitNodeTarget =
    exitNode.ips.find((ip) => ip.includes('.')) ??
    exitNode.ips[0] ??
    exitNode.dnsName ??
    exitNode.hostName
  const exitNodeName = exitNode.dnsName ?? exitNode.hostName
  const result = run(
    ['tailscale', 'set', `--exit-node=${exitNodeTarget}`, '--exit-node-allow-lan-access=true'],
    true
  )

  console.log('')
  console.log(`Fly app: ${appName}`)

  if (result.exitCode === 0) {
    console.log(`Local Tailscale is now using ${exitNodeName} as the exit node.`)
    return
  }

  console.log(`Created ${exitNodeName}, but could not switch your local client automatically.`)
  if (result.stdout) console.log(result.stdout)
  if (result.stderr) console.log(result.stderr)
  console.log(
    `Run this yourself: tailscale set --exit-node=${exitNodeTarget} --exit-node-allow-lan-access=true`
  )
}

async function down() {
  ;['fly', 'tailscale'].forEach(requireCommand)

  if (run(['tailscale', 'set', '--exit-node='], true).exitCode === 0) {
    console.log('Cleared the local Tailscale exit node.')
  }

  const appNames = parseResponseList<{
    name?: string
    Name?: string
    AppName?: string
  }>(run(['fly', 'apps', 'list', '--json']).stdout, 'apps')
    .map((row) => row.name ?? row.Name ?? row.AppName)
    .filter((name): name is string => typeof name === 'string' && name.startsWith(APP_PREFIX))
    .sort()

  if (appNames.length === 0) {
    console.log('No flyvpn Fly apps found.')
    return
  }

  console.log(`Destroying ${appNames.length} app(s)...`)

  for (const appName of appNames) {
    console.log(`- ${appName}`)

    const machinesResult = run(['fly', 'machine', 'list', '-a', appName, '--json'], true)
    const machines =
      machinesResult.exitCode !== 0 || !machinesResult.stdout
        ? []
        : parseResponseList<{
            id?: string
            ID?: string
            state?: string
            State?: string
          }>(machinesResult.stdout, 'machines')

    for (const machine of machines) {
      const id = machine.id ?? machine.ID ?? null
      const state = machine.state ?? machine.State ?? null
      if (!id || !state) continue

      if (state !== 'started') {
        await runInherited(['fly', 'machine', 'start', '-a', appName, id])
      }

      const result = run(
        [
          'fly',
          'machine',
          'exec',
          '-a',
          appName,
          id,
          '/bin/sh -lc "tailscale --socket=/tmp/tailscaled.sock logout || tailscale --socket=/var/run/tailscale/tailscaled.sock logout || tailscale logout"',
        ],
        true
      )
      if (result.exitCode === 0) {
        console.log(`  logged out Tailscale on machine ${id}`)
      } else {
        console.log(`  could not log out Tailscale on machine ${id}`)
        if (result.stdout) console.log(result.stdout)
        if (result.stderr) console.log(result.stderr)
      }
    }

    await runInherited(['fly', 'apps', 'destroy', appName, '-y'])
  }

  console.log('')
  console.log('Fly cleanup complete.')
}

function parseResponseList<T>(stdout: string, fallbackKey: string): T[] {
  const data = JSON.parse(stdout) as unknown
  if (Array.isArray(data)) return data as T[]
  if (typeof data !== 'object' || data === null) return []

  const list = (data as Record<string, unknown>)[fallbackKey]
  return Array.isArray(list) ? (list as T[]) : []
}

function run(args: string[], allowFailure = false, cwd?: string) {
  const proc = Bun.spawnSync(args, {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = new TextDecoder().decode(proc.stdout).trim()
  const stderr = new TextDecoder().decode(proc.stderr).trim()
  const exitCode = proc.exitCode

  if (exitCode !== 0 && !allowFailure) {
    const lines = [`Command failed (${exitCode}): ${args.join(' ')}`]
    if (stdout) lines.push(`stdout: ${stdout}`)
    if (stderr) lines.push(`stderr: ${stderr}`)
    throw new Error(lines.join('\n'))
  }

  return { stdout, stderr, exitCode }
}

async function runInherited(args: string[], cwd?: string) {
  const proc = Bun.spawn(args, {
    cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${args.join(' ')}`)
  }
}
