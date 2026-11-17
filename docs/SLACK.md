# Connecting Slack to Shiply tickets

Tickets work inside Shiply without Slack. Once Slack is connected, every ticket also reaches the
person in Slack, their answers in the Slack thread come back to the ticket, and reminders go out
in Slack.

Slack only lets other systems post and read messages through a Slack app. You create it once
(5 minutes) and paste two values into Render.

## 1. Create the app from our manifest

1. Open https://api.slack.com/apps and click **Create New App**.
2. Choose **From a manifest**, pick your Slack workspace, then **Next**.
3. Choose the **YAML** tab, delete what is there, paste the block below, then **Next** and **Create**.

```yaml
display_information:
  name: Shiply
  description: Shiply Now tickets
features:
  bot_user:
    display_name: Shiply
    always_online: true
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - im:write
      - im:history
settings:
  event_subscriptions:
    request_url: https://shiplynow.onrender.com/api/slack/events
    bot_events:
      - message.im
  interactivity:
    is_enabled: true
    request_url: https://shiplynow.onrender.com/api/slack/interactivity
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

If Slack says the events address could not be verified, finish steps 2 and 3 first (Shiply
must know the signing secret), then open **Event Subscriptions** in the app and click **Retry**.

## 2. Install it and copy the two values

1. In the app, open **Install App** and click **Install to Workspace**, then **Allow**.
2. Copy the **Bot User OAuth Token** (it starts with `xoxb-`).
3. Open **Basic Information** and copy the **Signing Secret** (click **Show**).

## 3. Paste them into Render

1. Render, the **shiplynow** service, **Environment**.
2. Add `SLACK_BOT_TOKEN` with the token and `SLACK_SIGNING_SECRET` with the secret.
3. **Save Changes**. Render restarts the service by itself.

Never paste these values in chat or email; they let anyone post as Shiply.

## 4. Tell Shiply who is who in Slack

For each team member: in Slack, open their profile, the three dots, **Copy member ID**
(it looks like `U0123ABCD`). In Shiply, **Admin, Users**, open the person, paste it in
**Slack member ID**, **Save**.

People without a Slack member ID still get their tickets inside Shiply.

## How it works

- A new ticket arrives as a direct message from Shiply with **I'm on it** and **Open in Shiply**.
- Replying in that message's thread answers the ticket; the person who asked gets the answer in
  Slack and in Shiply.
- Anything written on the ticket in Shiply also lands in the Slack thread.
- If the ticket is not opened in time (setting: remind if not opened after, 15 minutes), the
  person gets a reminder. If it is not answered in time (2 hours, or 30 minutes when urgent),
  both people are told and admin gets an alert. Times are in **Admin, Settings**.
- Slack does not tell apps when a message was read, so "seen" means: tapped **I'm on it**,
  replied, or opened the ticket in Shiply.
