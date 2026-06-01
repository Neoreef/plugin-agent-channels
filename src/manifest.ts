import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  EXPORT_NAMES,
  JOB_KEYS,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
  WEBHOOK_KEYS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Agent Channels",
  description:
    "Connects Paperclip Agents to users through everyday messaging channels. The plugin uses agent configurations to expose routes to an agent harness, and streams the response back. Platforms supported: Zoho Cliq, Teams, Discord, Slack.",
  author: "Neoreef",
  categories: ["connector", "automation"],
  capabilities: [
    "companies.read",
    "agents.read",
    "access.members.read",
    "agent.sessions.create",
    "agent.sessions.send",
    "activity.log.write",
    "plugin.state.read",
    "plugin.state.write",
    "events.subscribe",
    "jobs.schedule",
    "webhooks.receive",
    "http.outbound",
    "secrets.read-ref",
    "instance.settings.register",
    "ui.page.register",
    // Grants provider-key env passthrough (ADAPTER_ENV_PASSTHROUGH:
    // ANTHROPIC/OPENAI/GOOGLE/GEMINI/OPENROUTER) into the worker, so the
    // directly-spawned harness inherits the provider credential. We register
    // no environment driver; this capability is used only for the passthrough.
    "environment.drivers.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      zohoClientId: {
        type: "string",
        title: "Zoho Client ID",
      },
      zohoClientSecret: {
        type: "string",
        title: "Zoho Client Secret",
      },
      dataCenter: {
        type: "string",
        title: "Zoho Data Center",
        enum: ["US", "EU", "IN", "AU", "JP", "CA"],
        default: "US",
      },
      oauthCallbackUrl: {
        type: "string",
        title: "OAuth Callback URL",
        description:
          "Full URL for OAuth redirect (e.g. https://cortex.neoreef.com:8443/paperclip/api/plugins/{pluginId}/routes/callback).",
      },
    },
  },
  jobs: [
    {
      jobKey: JOB_KEYS.tokenRefresh,
      displayName: "Cliq Token Refresh",
      description: "Proactively refresh Zoho access token before expiry",
      schedule: "*/45 * * * *",
    },
  ],
  webhooks: [
    {
      endpointKey: "cliq-message",
      displayName: "Cliq Bot Messages",
      description: "Receives DM and mention events from Zoho Cliq bots",
    },
    {
      endpointKey: "oauth-callback",
      displayName: "OAuth Callback",
      description: "Receives OAuth authorization code from Zoho",
    },
  ],
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: SLOT_IDS.settingsPage,
        displayName: "Agent Channels Settings",
        exportName: EXPORT_NAMES.settingsPage,
      },
    ],
  },
};

export default manifest;
