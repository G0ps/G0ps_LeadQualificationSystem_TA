# Slack LeadQualifier AI Agent

An automated **Slack AI Agent** that listens for new members joining your workspace or channels, performs basic research on them using GitHub and their corporate domain websites via web scraping, and generates a detailed lead qualification report using an LLM pipeline. 

The primary analysis engine runs on **OpenAI (GPT-4o)**, and the agent features a robust, automatic failover mechanism that shifts tasks to **Google Gemini (Gemini 1.5 Flash)** if the primary LLM faces rate-limiting, network issues, or authentication failures.

---

## 🎯 Features & Core Logic

1. **Event Driven Triggers**: The app runs an Express server and listens for real-time Slack workspace events (`team_join` and `member_joined_channel`) using Socket Mode.
2. **Autonomous OSINT Background Research**: 
   - Scrapes the member's professional company domain (extracted from their corporate email address) to pull structural page details and titles.
   - Searches the GitHub API to check for developer profiles matching the user's name.
3. **Dual-LLM Resilient Analysis**: Passes collected metadata into LangChain prompts to extract a `fitScore` (0-100), key observations (`insights`), and execution-ready `recommendations`.
   - **Primary**: `OpenAI GPT-4o`
   - **Fallback**: `Google Gemini 1.5 Flash` (automatically kicks in upon any primary failure to guarantee uninterrupted execution).
4. **Persistent Datastore & Delivery**: Persists metadata snapshots directly into a database before reporting final stylized block layouts cleanly back into a designated private Slack channel.

---

## 🛠️ Local Setup Instructions

### Prerequisites
- Node.js (v18 or higher recommended)
- PostgreSQL database instance (local or hosted)
- A Slack App configured with Socket Mode enabled

### Installation
1. Clone this repository to your local machine.
2. Install the necessary dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory of your project (see configuration values below).
4. Run the development server locally:
   ```bash
   npm run dev
   ```

---

## 🔑 Required Environment Variables

Create a `.env` file in your root folder and configure the following variables:

```env
# Database Configuration
DATABASE_URL=your_postgresql_database_connection_string

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_APP_TOKEN=xapp-your-slack-app-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
SLACK_PRIVATE_CHANNEL_ID=your-private-channel-id-for-posts

# OpenAI Configuration
OPENAI_API_KEY=sk-proj-your-openai-api-key

# Google Gemini API Configuration (Fallback Engine)
GOOGLE_API_KEY=your-google-gemini-api-key

# Company Target Profiles
COMPANY_NAME="Code with Gopi"
COMPANY_PRODUCT="Coding Courses"

# Application Configuration
PORT=3000
NODE_ENV=development
```

---

## 🤖 Slack Bot Creation & Workspace Setup

To map the application code to your Slack workspace, create a new Slack app from scratch at [api.slack.com/apps](https://api.slack.com/apps):

1. **Enable Socket Mode**: Go to **Settings > Socket Mode** in your Slack Developer settings and toggle it **On**. Generate an App-level token here, select `connections:write`, and paste the token value into your `SLACK_APP_TOKEN` environment variable.
2. **Configure Event Subscriptions**: 
   - Go to **Features > Event Subscriptions** and toggle it **On**.
   - Under **Subscribe to bot events**, add the following permissions:
     - `team_join` (triggers when a user joins the workspace).
     - `member_joined_channel` (triggers when a user joins public/private channels).
3. **Configure OAuth & Permissions**:
   - Go to **Features > OAuth & Permissions**.
   - Under **Bot Token Scopes**, verify that `channels:read`, `groups:read`, `users:read`, `users:read.email`, and `chat:write` are added.
   - Click **Install to Workspace** at the top of the page to finalize configurations and generate your Bot User OAuth Token (`SLACK_BOT_TOKEN`).
4. **Get Signing Secret**: Go to **Settings > Basic Information** and grab your app's **Signing Secret** to populate `SLACK_SIGNING_SECRET`.

---

## 🚀 Cloud Deployment (Render)

This application is optimized and ready for zero-downtime hosting on **Render**:

1. Log into your account at [Render.com](https://render.com).
2. Create a new **PostgreSQL Database** instance on Render and copy its **Internal/External Database URL** connection string to populate your environment configs.
3. Deploy the application service by creating a new **Web Service** on Render, connecting your GitHub repository.
4. Choose `Node` as the environment runtime.
5. Set your build and start commands:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js` (or your main file entrypoint)
6. Open the **Environment** tab inside your Render Web Service dashboard and insert all the environment variables detailed above.

---

## 🧪 Local API Testing (Windows PowerShell)

When testing the analysis pipeline locally in a Windows environment, standard `curl` commands can cause JSON parsing exceptions due to quote escaping issues. 

Use the following native **PowerShell** snippet to send a properly formatted test payload to your local Express server:

```powershell
# 1. Define the test payload object and convert it to valid JSON
$body = @{
     memberInfo = @{
         name  = "John Doe"
         email = "john@techcorp.com"
         title = "Senior Software Engineer at TechCorp"
     }
} | ConvertTo-Json

# 2. Trigger the test analysis endpoint
Invoke-RestMethod -Uri "http://localhost:3000/test/analyze-member" -Method Post -ContentType "application/json" -Body $body

---

## ❤️ Credits & Appreciation

A heartfelt thank you goes out to **freeCodeCamp** and the co-creator **Ania Kubów** for producing the fantastic educational guide that inspired the framework for this automation pipeline.

📺 **Watch the original course tutorial on YouTube:** [Build Your Own AI Agent – Full Course with OpenAI, Langchain, Render Deployment](https://youtu.be/MnG0ugK2JAI?si=P4RfJYTMNNZ5Z7vL)