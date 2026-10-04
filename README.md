# dsh-mission-control

Remote mission control for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): supervise and steer your agents from a phone.

dsh-mission-control is a DSH plugin that adds a mobile-first web UI to a running DeepSeek Harness instance. Once loaded, the bottom tab bar offers four tabs:

- **Board** — live list of all sessions (root agents and sub-agents) with token/s metrics and context usage.
- **Attention** — pending approval requests that need the operator (v1; question answering and error items are future work).
- **Nuevo** — start a new session in an existing workspace from scratch.
- **Access** — diagnosis of the current remote-exposure setup and a QR code to transfer the session to a phone.

Tapping any session row on the Board opens the **Conversation** view (back button to return), which shows the session's history; a composer at the bottom lets you send new turns, which stream back as live bubbles. All views share a persistent SSE connection to the host.

---

## Requirements

- **Node.js** >= 22.19
- **DeepSeek Harness** 0.2.0-rc.2
  (the plugin is developed and tested against this exact version; it may not work on older or newer releases)
- **Tailscale** (optional, for remote access from a phone or other machine on a different network)

---

## Install

1. Clone or copy this package onto the machine where DeepSeek Harness runs.

2. Install dependencies and build:

```bash
pnpm install && pnpm run build
```

   This produces:
   - `lib/index.js` — the plugin bundle
   - `web-dist/` — the mobile web UI (static assets served by the plugin)

3. Load the plugin into the Harness `web` profile using one of these two methods:

   **Option A — from a packed tarball:**

```bash
cd /path/to/dsh-mission-control
pnpm pack
dsh plugin --profile web add ./dsh-mission-control-0.1.0.tgz
```

   **Option B — by adding a row to the profile patch** that composes the plugin from the built `lib/index.js`. When the plugin row is present in the patch (see `cordis.patch.yml`), add an `insert` entry to your profile's Cordis configuration:

```yaml
   # ~/.dsh/profiles/web/cordis.patch.yml or equivalent
   - insert:
       - id: dsh-mission-control
         name: file:///absolute/path/to/dsh-mission-control/lib/index.js
```

4. Start (or restart) the web host:

```bash
dsh web
```

5. Open `http://127.0.0.1:3080/mission/` on the same machine to verify the plugin mounted. You should see the Board tab.

---

## Develop

```bash
pnpm run check   # typecheck + unit tests + full build
```

`pnpm run check` runs `typecheck`, `test`, and `build` in sequence. All three must pass before committing.

---

## Expose it safely

The Harness web host binds to `127.0.0.1` by design and refuses `0.0.0.0`. To use the mission-control UI from a phone you need a tunnel that terminates TLS on the PC so the browser sees a valid certificate.

### Tailscale (recommended)

Tailscale creates a WireGuard VPN between your devices and gives you a real, publicly trusted TLS certificate for your `<machine>.<tailnet>.ts.net` address automatically via [Tailscale HTTPS](https://tailscale.com/kb/1153/tailscale-https/).

> **Note:** The commands below are documented from the Tailscale workflow described in the brief. Tailscale was not installed in the environment where this documentation was written, so the exact command syntax has not been verified against an installed version. Please run `tailscale serve --help` and `tailscale up --help` with your installed version to confirm the flags and arguments before running them on a production machine.

**Step 1 - Install Tailscale on the PC**

```bash
# Linux (other OSes: https://tailscale.com/download)
curl -fsSL https://tailscale.com/install.sh | sh
```

**Step 2 - Install Tailscale on the phone**

Download Tailscale from the app store (iOS/Android) and sign in with the same account as the PC.

**Step 3 - Authenticate both devices**

On the PC:
```bash
tailscale up
```

On the phone: open the Tailscale app and log in if prompted. Both devices should appear under the same tailnet in the admin console.

**Step 4 - Enable Tailscale HTTPS on the PC**

```bash
tailscale serve https 127.0.0.1:3080
```

This publishes the local Harness web UI at `https://<your-pc-hostname>.<tailnet>.ts.net/mission/`. The certificate is managed automatically by Tailscale.

**Step 5 - Start Harness with the trusted host**

```bash
dsh web --trusted-host <your-pc-hostname>.<tailnet>.ts.net
```

The `--trusted-host` flag tells the plugin to accept requests whose `Host` header matches the Tailscale DNS name, so the browser cookie is sent on every request.

**Step 6 - Access from the phone**

Open `https://<your-pc-hostname>.<tailnet>.ts.net/mission/` in the phone's browser. Log in with the same cookie you use on the PC. The session is now reachable over cellular or any network that can reach the Tailscale VPN.

---

### Alternative: Cloudflare Tunnel

If you prefer Cloudflare Access over Tailscale, create a named tunnel with a fixed hostname:

1. Install `cloudflared` on the PC: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/install-and-setup/tunnel-guide/

2. Create a named tunnel and reserve a fixed hostname in the Cloudflare dashboard.

3. Start the tunnel:

```bash
cloudflared tunnel run --name <tunnel-name> --url http://127.0.0.1:3080
```

4. Note the tunnel's hostname (e.g. `my-harness.example.com`).

5. Start Harness:

```bash
dsh web --trusted-host my-harness.example.com
```

6. Access from the phone at `https://my-harness.example.com/mission/`.

> **Security note:** The tunnel terminates TLS. The plugin adds no authentication of its own - it reuses the Harness session cookie. Make sure the tunnel or the Cloudflare Access policy restricts who can reach the URL, especially if your DSH instance has sensitive agent capabilities.

---

## Security

The plugin relies entirely on the DeepSeek Harness session cookie for authentication. The cookie is a bearer token valid for up to 30 days with no explicit logout mechanism.

**What the plugin does:**
- Reads existing sessions, approvals, and questions via the internal host APIs.
- Sends new turns, creates sessions, and resolves approvals on behalf of the operator.
- Adds **no new authentication layer** - it neither adds nor removes any auth.

**Revoking access:**
There is no per-session or per-device revocation built into the plugin. To revoke access:
1. Delete the `client-connection` (or browser-session) record that holds the cookie value. The exact path depends on your DSH storage backend.
2. Restart `dsh web`.

After restart the old cookie is no longer valid and the browser prompts for a fresh session.

**General advice:**
- Treat the cookie as a long-lived credential. Use a tunnel (Tailscale or Cloudflare) that you control rather than a public tunnel.
- Do not share the cookie value. The operator is the single operator as defined in the spec.

---

## Known limits

The following capabilities are intentionally out of scope:

| Not supported | Reason |
|---|---|
| File attachments from mobile | The host's `fileUploads` receipt-based prompt integration is a separate concern. |
| Rich tool-call / diff rendering in transcript | The mobile view shows plain text rows; deep rendering stays in the desktop GUI. |
| Queue / prompt-queue editing | Not requested by the operator; adds mutation surface. |
| Workspace creation, renaming, archiving | Supervision only, not workspace management. |
| Background jobs, compaction, model switching | Not requested; add later if needed. |
| Push notifications | A separate `dsh-notification` plugin covers turn-finished alerts; a cockpit-native notification is future work. |
| Public quick tunnel without a domain | A 30-day bearer cookie in front of remote code execution requires a controlled entry point. |
| Multi-user / multi-operator | Single-operator design. |

---

## Compatibility

Developed against **DeepSeek Harness 0.2.0-rc.2**. The plugin reads internal host services (session controller, approval registry, question registry, token meter) to build its UI. These internal services are not part of the public DSH API and may change between releases. The plugin will need to be updated if the services it depends on change their interfaces.

---

## License

MIT
