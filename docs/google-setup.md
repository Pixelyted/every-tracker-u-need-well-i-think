# Connecting every tracker u need, well i think to Google Calendar

The app can copy your quests into a Google calendar called
**⚔ every tracker u need, well i think**, so Google reminds you on your phone even when the laptop is
closed. The push only goes one way: from the app to Google. Make your edits
in the app, because changes you make in Google are overwritten on the next
push. The app can only see and change the calendars it created itself, never
your other calendars. The ⚔ every tracker u need, well i think calendar belongs to the app: **don't
add your own events to it**, because the next push removes anything the app
didn't put there. Use your normal calendar for those.

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
   find `.../auth/calendar.app.created` ("Make secondary Google calendars,
   and see, create, change, and delete events on them"), tick it and save.

> **About Testing mode:** Google ends the sign-in of a Testing app after
> **7 days**. When that happens, the app shows a desktop
> notification, **"Google disconnected, reconnect in Settings"**, and a
> red **⚠ Google disconnected · Reconnect** button on the main screen.
> Click either one, sign in again, and the push picks up where it left off.
> Nothing in the app is lost while it's disconnected.

## 4. Create the client ID

1. Go to **APIs & Services → Credentials** (or **Google Auth Platform →
   Clients**) → **Create credentials → OAuth client ID**.
2. **Application type:** **Desktop app**. Name: `every tracker u need, well i think`.
3. Click **Create**. Copy the **Client ID** (ends in
   `.apps.googleusercontent.com`) and the **Client secret**.

## 5. Connect the app

1. In the app, open **⚙ Settings → Google Calendar**.
2. Paste the **Client ID** and **Client secret**.
3. Click **Connect Google**. Your browser opens Google's sign-in.
4. Choose your account. Google warns **"Google hasn't verified this app"**.
   That's expected for your own personal app: click **Continue**.
5. Allow access to the calendars the app creates. The browser shows
   **"⚔ Connected!"**. Close the tab.
6. Settings now reads **Last pushed HH.MM**.

## 6. On your phone

1. Open Google Calendar. A new calendar **⚔ every tracker u need, well i think** appears (in the menu
   under your account). If you don't see it, pull down to refresh or check
   that it's ticked.
2. Turn on its notifications: **Settings → ⚔ every tracker u need, well i think → notifications**. The
   app already sets a reminder 15 minutes before each quest, plus 20.00 the
   evening before a boss quest or limited event.

## If something goes wrong

| What you see | What to do |
|--------------|------------|
| `Error 403: access_denied` in the browser | Your email isn't a test user yet. Add it (step 3.5) and connect again. |
| `Error 400: redirect_uri_mismatch` | The client type isn't **Desktop app**. Create a new Desktop client (step 4). |
| Settings says **Push failed, will retry** | Usually no internet. The app tries again every 5 minutes and right after your next change. |
| **Google disconnected** notification | The 7-day Testing sign-in ended. Click **Reconnect**. |
| You deleted or edited an event in Google by mistake (even just one week of a weekly class) | The next push puts it back. The app pushes when it starts, after you change something in it, every 30 minutes by itself, and when you click **Push now** in Settings. |

**Disconnect** in Settings stops pushing and forgets the sign-in. The
⚔ every tracker u need, well i think calendar stays in Google: delete it there if you don't want it
any more.
