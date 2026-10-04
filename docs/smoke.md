# Mission Control — Smoke Test Checklist

Perform these steps in order. Check each box as you verify it.

---

### Prerequisites

- A running DeepSeek Harness 0.2.0-rc.2 installation.
- The dsh-mission-control plugin loaded in the `web` profile.
- The browser has an active session cookie (either a new one created for this test, or an existing one).

---

### Step 1 — Plugin mounts

- [ ] `dsh web` starts without errors.
- [ ] Open `http://127.0.0.1:3080/mission/` — the Board tab loads without a 404 or a blank screen.
- [ ] No errors about missing `/mission/api/fleet` appear in the browser console.

---

### Step 2 — Login gate without cookie

- [ ] Clear the browser session cookie for `127.0.0.1`.
- [ ] Reload `http://127.0.0.1:3080/mission/`.
- [ ] The page redirects to a login prompt or returns HTTP 401 (it does not show the Board).

---

### Step 3 — Board lists real sessions (with cookie)

- [ ] Restore the session cookie (log in through the harness GUI on the same machine first if needed).
- [ ] Reload `http://127.0.0.1:3080/mission/`.
- [ ] The Board tab shows at least one session card.
- [ ] Each visible session shows **context** (used / window, as a percentage or count) and status (running/idle/waiting/error).
- [ ] Sub-agents are indented under their parent session.

---

### Step 4 — Open a conversation

- [ ] Tap / click a session card to open the Conversation tab.
- [ ] The transcript scrolls back through past turns (history is visible).
- [ ] Type a message in the composer and send it.
- [ ] Within a few seconds, a new assistant turn appears as a **live bubble** (the turn started indicator shows and updates as text streams in).

---

### Step 5 — New session from Nuevo tab

- [ ] Switch to the **Nuevo** tab.
- [ ] Choose an existing workspace from the picker.
- [ ] Enter a prompt and submit.
- [ ] The page navigates to the new session's Conversation view, or the Board refreshes and shows the new session at the top.
- [ ] The new session persists after a page reload.

---

### Step 6 — Provoke and resolve an approval

- [ ] Trigger a command in any running agent that requires operator approval (e.g. run a `bash` command with side effects from an agent prompt).
- [ ] Switch to the **Attention** tab — an approval card appears with the tool name and reason.
- [ ] Tap **Allow** (or **Deny**) on the approval card from the phone.
- [ ] The agent resumes or stops accordingly, and the approval disappears from the Attention tab.

---

### Step 7 — Remote access over Tailscale (steps 3–6 repeated)

- [ ] Connect the phone to the same Tailscale tailnet as the PC.
- [ ] Open `https://<pc-hostname>.<tailnet>.ts.net/mission/` in the phone browser.
- [ ] The session cookie from step 3 is sent automatically (or you are prompted to log in if you cleared it).
- [ ] Repeat **steps 3 through 6** on the phone:
  - [ ] Board lists sessions with context usage and status.
  - [ ] Conversation shows history and live bubbles.
  - [ ] Nuevo creates a session visible on the Board.
  - [ ] Approval cards appear and can be resolved.

---

### Step 8 — Network cut and reconnect

- [ ] With the phone connected to the Tailscale URL, enable airplane mode (cut network).
- [ ] Wait ~10 seconds then disable airplane mode and restore connectivity.
- [ ] Reload `https://<pc-hostname>.<tailnet>.ts.net/mission/`.
- [ ] The page re-establishes the SSE stream without crashing.
- [ ] A fresh snapshot is requested and the Board repopulates (no stale data, no console errors).

---

### Step 9 — Restart DSH and cookie persistence

- [ ] While the browser on the PC still has the session cookie, stop `dsh web` (Ctrl+C or kill).
- [ ] Start `dsh web --trusted-host <pc-hostname>.<tailnet>.ts.net` again.
- [ ] On the PC, open `http://127.0.0.1:3080/mission/` — the cookie is still accepted and the Board loads without a login prompt.
- [ ] On the phone, open the Tailscale URL — same result (cookie still valid).

---

*End of smoke checklist.*
