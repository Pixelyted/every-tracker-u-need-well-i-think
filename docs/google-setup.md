# Connecting every tracker u need, well i think to Google Calendar

The app syncs with Google Calendar in two directions. It copies your quests
into a Google calendar called **⚔ every tracker u need, well i think**, so
Google reminds you on your phone even when the laptop is closed, and edits you
make to those events in Google come back into the app (see "Two-way sync"
below). By default the app can only see and change the calendars it created
itself, never your other calendars. If you tick the main-calendar checkbox
(see below), it can also read and change events on your main calendar.

This takes about 10 minutes, once. You need a Google account and a browser.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in.
2. **Skip the Free Trial.** If a banner offers "Start free" or "Free trial",
   or asks for a credit card, close it. The Calendar API is free and doesn't
   need billing, so **don't set up a billing account**.
3. Click the project picker at the top → **New project**. Name it
   `every tracker u need, well i think` and click **Create**. Make sure it is selected in the
   project picker afterwards.

## 2. Turn on the Google Calendar API

1. Go to **APIs & Services → Library** (or search "Google Calendar API" in
   the top search bar).
2. Open **Google Calendar API** and click **Enable**.

## 3. Set up the sign-in screen (stays in Testing)

1. Go to **APIs & Services → OAuth consent screen**. On newer consoles this
   is called **Google Auth Platform**. Click **Get started** if asked.
2. **App name:** `every tracker u need, well i think`. **User support email** and **contact
   email:** your own email.
3. **Audience:** choose **External**.
4. Leave the app in **Testing**. **Do not click "Publish app".**
5. Under **Audience → Test users**, click **Add users** and add **your own
   Gmail address**. Only test users can sign in, which is exactly what you
   want.
6. Under **Data access** (or **Scopes**), click **Add or remove scopes**,
   find these and tick them:
   - `https://www.googleapis.com/auth/calendar.app.created` ("Make secondary
     Google calendars, and see, create, change, and delete events on them").
     Always needed.
   - `https://www.googleapis.com/auth/calendar.events` ("See, create, change,
     and delete events on all your calendars"). **Only needed for the
     main-calendar checkbox** (see "Two-way sync" below). Optional: tick it
     if you want that checkbox.

   Then save.

> **About Testing mode:** Google ends the sign-in of a Testing app after
> **7 days**. When that happens, the app shows a desktop
> notification, **"Google disconnected, reconnect in Settings"**, and a
> red **⚠ Google disconnected · Reconnect** button on the main screen.
> Click either one, sign in again, and the sync picks up where it left off.
> Nothing in the app is lost while it's disconnected.

## 4. Create the client ID

1. Go to **APIs & Services → Credentials** (or **Google Auth Platform →
   Clients**) → **Create credentials → OAuth client ID**.
2. **Application type:** **Desktop app**. Name: `every tracker u need, well i think`.
3. Click **Create**. Copy the **Client ID** (ends in
   `.apps.googleusercontent.com`) and the **Client secret**.

## 5. Connect the app

1. In the app, open **⚙ Settings → Google Calendar sync**.
2. Paste the **Client ID** and **Client secret**.
3. Click **Connect Google**. Your browser opens Google's sign-in.
4. Choose your account. Google warns **"Google hasn't verified this app"**.
   That's expected for your own personal app: click **Continue**.
5. Allow access to the calendars the app creates. The browser shows
   **"⚔ Connected!"**. Close the tab.
6. Settings now shows the **Google Calendar sync** section and reads **Last synced HH.MM**.

## 6. On your phone

1. Open Google Calendar. A new calendar **⚔ every tracker u need, well i think** appears (in the menu
   under your account). If you don't see it, pull down to refresh or check
   that it's ticked.
2. Turn on its notifications: **Settings → ⚔ every tracker u need, well i think → notifications**. The
   app already sets a reminder 15 minutes before each quest, plus 20.00 the
   evening before a boss quest or limited event.

## 7. Two-way sync

The **Sync now** button in Settings runs a sync by hand. A sync also runs when
the app starts, after you change something, and every 30 minutes.

**The ⚔ calendar** (always two-way). Edits you make to its events in Google
come back:

- Move one week of a weekly class and it becomes a make-up. Delete one week
  and it becomes a skip.
- Editing a whole repeating series in Google is not understood. The app resets
  it to what the app says.
- Edits and deletes of one-off quests and bounties are applied.
- An event you add by hand becomes a side quest.

**Your main calendar** (optional). Tick **Two-way with my main Google
calendar** in Settings. It is off by default. Turning it on asks Google for the
wider permission `calendar.events`, so the app sends you through the sign-in
again. Without it, only the ⚔ calendar is two-way.

- Upcoming events that don't repeat and that you haven't declined become side
  quests tagged 📅. Repeating events are not imported.
- Edits and deletes go both ways. If you delete an imported quest in the app,
  the event is deleted in Google too. Invitations organised by someone else
  are locked: the app can't change them, so deleting one only hides it in the
  app.
- Imported quests **never go into the ⚔ calendar**, so you don't get doubles.
- If the same thing was edited on both sides, the newest edit wins.

**Safety:**

- If a sync would delete more than **5** quests because of deletions in
  Google, it holds them back. Nothing is deleted until you click **Sync now**
  within 10 minutes. This protects you from a mistake or a glitch wiping many
  quests.
- If the app can't read Google (no internet, an error), it changes nothing in
  the app.
- Turning the checkbox off, or disconnecting, keeps the quests already
  imported.

## If something goes wrong

| What you see | What to do |
|--------------|------------|
| `Error 403: access_denied` in the browser | Your email isn't a test user yet. Add it (step 3.5) and connect again. |
| `Error 400: redirect_uri_mismatch` | The client type isn't **Desktop app**. Create a new Desktop client (step 4). |
| Settings says **Sync failed, will retry** | Usually no internet. The app tries again every 5 minutes and right after your next change. |
| **Google disconnected** notification | The 7-day Testing sign-in ended. Click **Reconnect**. |
| You deleted or edited an event in Google by mistake (even just one week of a weekly class) | In the ⚔ calendar, a deleted or moved week turns into a skip or make-up (see step 7), so do those edits on purpose. The app syncs when it starts, after you change something in it, every 30 minutes by itself, and when you click **Sync now** in Settings. |

**Disconnect** in Settings stops syncing and forgets the sign-in. The
⚔ every tracker u need, well i think calendar stays in Google: delete it there if you don't want it
any more.
