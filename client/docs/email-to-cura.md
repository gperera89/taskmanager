# Email to Cura

Send or forward an email to Cura's inbound address and an LLM extracts the actionable content,
turning it into tasks or a project broken into subtasks. Items are created immediately and appear
as an unread notice in the notification panel (labeled **Email**), so you can check they landed
right.

## How to steer it

### Task vs. project — controlled by the subject prefix

| Subject starts with | Result |
|---|---|
| `Project: …` | One **project**, with the email's steps broken into subtasks |
| `Task: …` / `Tasks: …` / `Todo: …` | One or more **loose tasks** |
| *(no prefix)* | Loose tasks — Cura **never** auto-creates a project without `Project:` |

The prefix is stripped from the title, so `Project: Science open evening` names the project
"Science open evening".

### Home vs. work — controlled by the sending account

| You send from | Category context |
|---|---|
| `gayan.perera@ycis.com` (any `@ycis.com`) | **Work** |
| `g.perera26@gmail.com` (Gmail / anything else on the allowlist) | **Home** |

The AI picks the best-fitting category for that context; if it can't, it falls back to your
Work/Home category. Only allowlisted senders are processed — mail from anywhere else is silently
ignored (accepted with HTTP 200 so the provider doesn't retry or bounce, but nothing is created).

## What the AI fills in from the email

For **each task**: a short title (required), an optional description, a due date (it resolves
relative dates like "tomorrow" / "next Friday" and explicit dates), a due time (only if you state
one), and the category. For a **project** it also writes a project name, description, and optional
due date. Anything you don't mention is left blank.

## Tips for clean results

- **Put the outcome in the subject.** `Project: Term 3 report cards` beats a vague subject — the
  subject becomes the project/task title.
- **One action per line or sentence** in the body → one task each. Bullet lists work well.
- **State dates and times naturally** ("by next Friday", "on the 12th", "at 3pm") when they matter.
- **Forwarding an email?** Quoted threads, signatures, and disclaimers are ignored — add a one-line
  subject or opening saying what you want done, or it will only extract what it can infer.

## Setup / operations

Inbound mail is handled by **Postmark** (inbound message stream) posting a webhook to Cura.

- **Route:** `src/app/api/email-inbound/[secret]/route.ts` — authenticated by a secret in the URL
  path plus the sender allowlist. Exempted from the auth redirect in `src/proxy.ts`.
- **Parser:** `src/lib/email.ts` (`parseEmailToItems`, gpt-4o-mini) — mirrors the voice pipeline in
  `src/lib/voice.ts`.
- **Webhook URL** to configure in Postmark:
  `https://<app-domain>/api/email-inbound/<INBOUND_EMAIL_SECRET>`

### Environment variables

| Var | Required | Purpose |
|---|---|---|
| `INBOUND_EMAIL_SECRET` | Yes | Secret embedded in the webhook URL path. Must match in Vercel. |
| `INBOUND_EMAIL_ALLOWED` | No | Comma-separated sender allowlist. Defaults to `g.perera26@gmail.com, gayan.perera@ycis.com`. |
| `OPENAI_API_KEY` | Yes | Used for the extraction (shared with voice/chat). |

### Troubleshooting

- **Postmark shows a 404** — the secret in the webhook URL doesn't match `INBOUND_EMAIL_SECRET` in
  Vercel, or a new deploy hasn't picked up the env var.
- **Postmark shows 200 but nothing appears** — the sender isn't on the allowlist (check the exact
  From address), or `OPENAI_API_KEY` is missing.
- **It appeared but late** — the app only refreshes captures when the tab regains focus; switch
  away and back.
