# Dukaan Dost on WhatsApp

A real WhatsApp bot for Dukaan Dost. The shop owner types or sends a **voice note in any Indian language** (Hindi, Telugu, Tamil, Bengali, Marathi… or Hinglish), and the bot replies **in the same language**: the morning plan, saved sales, stock answers, orders and offers, with tap buttons.

- **WhatsApp:** Meta WhatsApp Cloud API (free test number, up to 5 phone numbers)
- **AI:** Google Gemini (free key) understands text and voice notes in Indian languages and translates replies
- **Brain:** the same `engine.js` as the web app
- **Server:** Node.js 18+, **no npm packages**

```
server.js      receives WhatsApp messages (webhook) and replies
bot.js         the conversation: plan, sales, stock, orders, offers, end of day
ai.js          Gemini: understand any language, translate replies
whatsapp.js    sends texts and buttons, downloads voice notes
engine.js      decision engine (copied from the web app)
data.js        sample shop data (copied from the web app)
twilio.js      the same, through the Twilio WhatsApp Sandbox (no Facebook needed)
test-bot.js    offline test with fake WhatsApp and Gemini (node test-bot.js)
test-twilio.js offline test for the Twilio route (node test-twilio.js)
```

## No Facebook account? Use the Twilio Sandbox

Meta’s setup needs a Facebook login. Twilio’s WhatsApp Sandbox does not: sign up with email and phone.

1. Sign up at **twilio.com/try-twilio** and verify your email and phone.
2. In the Console, open **Messaging → Try it out → Send a WhatsApp message**. Note the Sandbox number (**+1 415 523 8886**) and your join code (`join two-words`). From your WhatsApp, send that join message to the Sandbox number. Teammates do the same. (Joining lasts 3 days.)
3. On the Console home page, copy the **Account SID** and **Auth Token**.
4. Deploy on Render as in step 3 below, but with these environment variables instead of the Meta ones: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `GEMINI_API_KEY` (and optionally `DISTRIBUTOR_NUMBER`, `CUSTOMER_NUMBERS` for teammates who joined the Sandbox).
5. In Twilio’s Sandbox settings, set **When a message comes in** to `https://YOUR-APP.onrender.com/twilio` (method POST) and save.
6. Message the Sandbox number: `namaste`, `aaj 6 bread aur 4 dahi bika`, a voice note… Tap buttons don’t exist in the Sandbox, so the bot offers **reply 1, 2 or 3** instead. Replies arrive about 3 seconds apart (a Sandbox limit).

## Set it up with Meta (about 45 minutes)

### 1. Get a free Gemini API key (5 min)
Go to **aistudio.google.com** → sign in → **Get API key** → **Create API key**. Copy it.

### 2. Create the WhatsApp test number (15 min)
1. Go to **developers.facebook.com** → log in → **My Apps** → **Create app**. Choose the WhatsApp / “Connect with customers” use case (or type **Business**), and create it.
2. In the app, open **WhatsApp → API Setup**:
   - Click **Generate access token** and copy it (it lasts 24 hours).
   - Copy the **Phone number ID** (15 digits, *not* the WhatsApp Business Account ID).
   - In the **To** field → **Manage phone number list** → add your own WhatsApp number and enter the code you receive. Add teammates’ numbers too (up to 5).
   - Click **Send message** to get the “Hello World” message on your phone. Save the test number as a contact.

### 3. Put the code online with Render (15 min)
1. On **github.com**, create a new repository (e.g. `dukaan-dost-bot`) → **uploading an existing file** → drag in **all the files from this folder** → **Commit**.
2. On **render.com**, sign in with GitHub → **New → Web Service** → pick the repository.
   - Runtime: **Node** · Build command: `npm install` · Start command: `node server.js` · Instance type: **Free**
   - **Environment variables:**

| Name | Value |
|---|---|
| `WHATSAPP_TOKEN` | the access token from step 2 |
| `PHONE_NUMBER_ID` | the Phone number ID from step 2 |
| `VERIFY_TOKEN` | any word you choose, e.g. `dukaan-dost-2026` |
| `GEMINI_API_KEY` | the key from step 1 |
| `DISTRIBUTOR_NUMBER` | optional: a teammate’s number, e.g. `919876543210`, to receive orders |
| `CUSTOMER_NUMBERS` | optional: teammates’ numbers, comma-separated, to receive offers |

3. **Create Web Service.** When it says *Live*, open your URL (like `https://dukaan-dost-bot.onrender.com`). You should see *“Dukaan Dost WhatsApp bot is running. AI: on”*.

### 4. Connect WhatsApp to your server (5 min)
In Meta: **WhatsApp → Configuration → Webhook → Edit**
- Callback URL: `https://YOUR-APP.onrender.com/webhook`
- Verify token: the same word as `VERIFY_TOKEN`
- **Verify and save**, then under **Webhook fields** → **messages** → **Subscribe**.

### 5. Try it
From your phone, message the test number:
- `hi` → welcome + morning plan + buttons
- `aaj 6 bread aur 4 dahi bika` → saved, reply in Hinglish
- a **voice note** in Telugu, Tamil, Hindi… → reply in that language
- tap **Send order** / **Send offer**
- `paneer kitna bacha hai?` · `summary` · `end day` · `reset`

## Before a demo
- **Wake the server 2 minutes before:** open your Render URL in a browser. The free plan sleeps after 15 minutes and takes about a minute to wake.
- The temporary token lasts **24 hours**. If replies stop, generate a new one in API Setup and update `WHATSAPP_TOKEN` in Render (Environment → Save → it redeploys).
- Teammates who should receive orders or offers must be in Meta’s recipient list **and** must send the test number any message first (WhatsApp only allows free-form replies within 24 hours of the person’s last message).
- Check Render’s **Logs** tab to see every message the bot heard, its language and intent.

## Limits of this version
- Each phone number gets its own demo shop with sample data, kept in memory (it resets when the server restarts).
- The 8 AM morning plan is sent when the owner asks. Sending it automatically every morning needs a pre-approved WhatsApp message template.
- A real business needs Meta business verification and its own phone number.
