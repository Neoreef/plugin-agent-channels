import { useState, useCallback, useEffect, useRef, type CSSProperties } from "react";
import {
  usePluginAction,
  usePluginData,
  type PluginSettingsPageProps,
} from "@paperclipai/plugin-sdk/ui";

// ─── Styles ─────────────────────────────────────────────────────────────────

const btn: CSSProperties = {
  appearance: "none", border: "1px solid var(--border)", borderRadius: "999px",
  background: "transparent", color: "inherit", padding: "6px 14px", fontSize: "12px", cursor: "pointer",
};
const btnPrimary: CSSProperties = { ...btn, background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" };
const btnDanger: CSSProperties = { ...btn, color: "var(--destructive, #dc2626)", borderColor: "var(--destructive, #dc2626)" };
const btnSmall: CSSProperties = { ...btn, padding: "4px 10px", fontSize: "11px" };
const btnSmallDanger: CSSProperties = { ...btnDanger, padding: "4px 10px", fontSize: "11px" };

const inputStyle: CSSProperties = {
  flex: 1, border: "1px solid var(--border)", borderRadius: "8px",
  padding: "8px 10px", background: "transparent", color: "inherit", fontSize: "12px", minWidth: 0,
};
const selectStyle: CSSProperties = { ...inputStyle, cursor: "pointer", minWidth: 160 };

const section: CSSProperties = { marginBottom: "1.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "1.25rem" };
const row: CSSProperties = { display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center" };
const btnGroup: CSSProperties = { display: "flex", gap: "0.5rem", marginTop: "0.75rem" };
const muted: CSSProperties = { fontSize: "12px", color: "var(--muted-foreground, #888)" };
const dot = (ok: boolean): CSSProperties => ({
  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
  background: ok ? "var(--success, #22c55e)" : "var(--destructive, #dc2626)", marginRight: 6,
});
const cardStyle: CSSProperties = {
  border: "1px solid var(--border)", borderRadius: "12px", padding: "1rem 1.25rem",
  marginBottom: "1rem", background: "var(--card, transparent)",
};
const cardHeaderStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem",
};
const badgeStyle = (active: boolean): CSSProperties => ({
  fontSize: "10px", padding: "2px 8px", borderRadius: "999px",
  background: active ? "var(--success, #22c55e)" : "var(--muted, #666)",
  color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px",
});

// ─── Types ──────────────────────────────────────────────────────────────────

type AuthType = "oauth" | "bearer" | "apikey" | "none";
type ServiceDef = {
  type: string; name: string; description: string; status: "available" | "coming-soon";
  authType: AuthType;
  scopes?: string;
  provider?: string;
};
type ConnectionStatus = { connected: boolean; dataCenter: string; connectedUser?: string; tokenExpiresAt?: number; tokenValid: boolean };
type ConnectUrlData = { connectUrl: string; configured: boolean };
type IdName = { id: string; name: string };
type BotMapping = { botUniqueName: string; agentId: string; companyId: string; enabled: boolean };
type ServiceRecord = { id: string; type: string; name: string; enabled: boolean; createdAt: string };

const AVAILABLE_CHANNELS: ServiceDef[] = [
  {
    type: "zoho-cliq", name: "Zoho Cliq",
    description: "Agent chat through Zoho Cliq bots",
    status: "available", authType: "oauth", provider: "zoho",
    scopes: "ZohoCliq.Webhooks.CREATE,ZohoCliq.Webhooks.UPDATE,ZohoCliq.Messages.READ,ZohoCliq.Messages.DELETE,ZohoCliq.Chats.READ,ZohoCliq.Bots.READ,ZohoCliq.Attachments.READ",
  },
  { type: "microsoft-teams", name: "Microsoft Teams", description: "Bot conversations in Teams", status: "coming-soon", authType: "oauth", provider: "microsoft" },
  { type: "discord", name: "Discord", description: "Bot commands in Discord servers", status: "coming-soon", authType: "oauth", provider: "discord" },
  { type: "slack", name: "Slack", description: "Bot conversations in Slack workspaces", status: "coming-soon", authType: "oauth", provider: "slack" },
];

// ─── Autocomplete Component ─────────────────────────────────────────────────

type AutocompleteOption = { id: string; label: string; sublabel?: string };

function Autocomplete({
  options, value, onChange, placeholder, disabled,
}: {
  options: AutocompleteOption[];
  value: string;
  onChange: (id: string, label: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value ? options.find((o) => o.id === value)?.label ?? "" : "");
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = (query.length === 0
    ? options
    : options.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.sublabel?.toLowerCase().includes(query.toLowerCase()) ?? false)
      )
  ).filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (value) {
      const match = options.find((o) => o.id === value);
      if (match && match.label !== query) setQuery(match.label);
    }
  }, [value, options]);

  const select = (opt: AutocompleteOption) => {
    setQuery(opt.label);
    setOpen(false);
    setFocusIdx(-1);
    onChange(opt.id, opt.label);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && focusIdx >= 0 && filtered[focusIdx]) { e.preventDefault(); select(filtered[focusIdx]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input
        style={inputStyle}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setFocusIdx(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          maxHeight: 200, overflowY: "auto",
          border: "1px solid var(--border)", borderRadius: "8px",
          background: "var(--popover, var(--background, #1a1a1a))",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)", marginTop: 2,
        }}>
          {filtered.map((opt, i) => (
            <div
              key={opt.id}
              style={{
                padding: "6px 10px", cursor: "pointer", fontSize: "12px",
                background: i === focusIdx ? "var(--accent, rgba(255,255,255,0.1))" : "transparent",
              }}
              onMouseEnter={() => setFocusIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); select(opt); }}
            >
              {opt.label}
              {opt.sublabel && <span style={{ ...muted, marginLeft: 6 }}>{opt.sublabel}</span>}
            </div>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && query.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          padding: "8px 10px", fontSize: "12px",
          border: "1px solid var(--border)", borderRadius: "8px",
          background: "var(--popover, var(--background, #1a1a1a))",
          color: "var(--muted-foreground, #888)", marginTop: 2,
        }}>
          No matches
        </div>
      )}
    </div>
  );
}

// ─── OAuth Setup Component (reusable per service) ───────────────────────────

function OAuthSetup({ serviceId, serviceDef }: { serviceId: string; serviceDef: ServiceDef }) {
  const { data: status, refresh } = usePluginData<ConnectionStatus>("connection-status", { serviceId });
  const { data: connectData, refresh: refreshConnectUrl } = usePluginData<ConnectUrlData>("connect-url", { serviceId, scopes: serviceDef.scopes ?? "" });
  const saveOAuthConfig = usePluginAction("save-service-oauth-config");
  const disconnectAction = usePluginAction("disconnect-service");

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("https://cortex.neoreef.com:8443/oauth/callback");
  const [dataCenter, setDataCenter] = useState("US");
  const [configSaved, setConfigSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Poll while disconnected
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!status?.connected) {
      pollRef.current = setInterval(() => refresh(), 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status?.connected, refresh]);

  const handleSaveConfig = useCallback(async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      await saveOAuthConfig({ serviceId, clientId, clientSecret, callbackUrl, dataCenter });
      setConfigSaved(true);
      setTimeout(() => { refresh(); refreshConnectUrl(); }, 500);
    } catch (e) {
      console.error("Failed to save OAuth config:", e);
    } finally {
      setSaving(false);
    }
  }, [serviceId, clientId, clientSecret, callbackUrl, dataCenter, saveOAuthConfig, refresh, refreshConnectUrl]);

  const handleDisconnect = useCallback(async () => {
    if (confirm("Disconnect this service? You will need to re-authenticate.")) {
      await disconnectAction({ serviceId });
      refresh();
    }
  }, [serviceId, disconnectAction, refresh]);

  if (status?.connected) {
    return (
      <div style={{ ...section, paddingTop: "0.5rem" }}>
        <h4 style={{ marginTop: 0 }}>Connection</h4>
        <p style={{ margin: "0.25rem 0" }}>
          <span style={dot(status.tokenValid)} />
          Connected ({status.dataCenter})
          {" "}<span style={muted}>
            {status.tokenValid ? "Token valid" : "Token expired"}
            {status.tokenExpiresAt && ` — expires ${new Date(status.tokenExpiresAt).toLocaleString()}`}
          </span>
        </p>
        <div style={btnGroup}>
          {connectData?.configured && (
            <a href={connectData.connectUrl} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>
              <button type="button" style={btn}>Reconnect</button>
            </a>
          )}
          <button type="button" style={btnDanger} onClick={handleDisconnect}>Disconnect</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...section, paddingTop: "0.5rem" }}>
      <h4 style={{ marginTop: 0 }}>Connection</h4>
      <p style={muted}>Enter your {serviceDef.provider === "zoho" ? "Zoho API Console" : serviceDef.name} OAuth credentials.</p>
      <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
        <div style={row}>
          <label style={{ width: 110, fontSize: "12px", flexShrink: 0 }}>Client ID</label>
          <input style={inputStyle} value={clientId} onChange={(e) => { setClientId(e.target.value); setConfigSaved(false); }} placeholder="Client ID" />
        </div>
        <div style={row}>
          <label style={{ width: 110, fontSize: "12px", flexShrink: 0 }}>Client Secret</label>
          <input style={inputStyle} type="password" value={clientSecret} onChange={(e) => { setClientSecret(e.target.value); setConfigSaved(false); }} placeholder="Client secret" />
        </div>
        <div style={row}>
          <label style={{ width: 110, fontSize: "12px", flexShrink: 0 }}>Callback URL</label>
          <input style={inputStyle} value={callbackUrl} onChange={(e) => { setCallbackUrl(e.target.value); setConfigSaved(false); }} />
        </div>
        {serviceDef.provider === "zoho" && (
          <div style={row}>
            <label style={{ width: 110, fontSize: "12px", flexShrink: 0 }}>Data Center</label>
            <select style={{ ...selectStyle, flex: 0, minWidth: 80 }} value={dataCenter} onChange={(e) => { setDataCenter(e.target.value); setConfigSaved(false); }}>
              {["US", "EU", "IN", "AU", "JP", "CA"].map((dc) => <option key={dc} value={dc}>{dc}</option>)}
            </select>
          </div>
        )}
      </div>
      <div style={btnGroup}>
        {!configSaved ? (
          <button type="button" style={btnPrimary} onClick={handleSaveConfig} disabled={!clientId || saving}>
            {saving ? "Saving..." : "Save & Continue"}
          </button>
        ) : connectData?.configured ? (
          <a href={connectData.connectUrl} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>
            <button type="button" style={btnPrimary}>Connect to {serviceDef.name}</button>
          </a>
        ) : (
          <button type="button" style={btnPrimary} onClick={() => refresh()}>
            Loading connect URL... (click to retry)
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Cliq Config (bot mappings, shown after OAuth) ──────────────────────────

// ─── Deluge Script Templates ────────────────────────────────────────────────

const WEBHOOK_URL = "https://cortex.neoreef.com:8443/cliq";

function delugeMessageHandler(botName: string): string {
  return `bot_name = "${botName}";
recent_messages = chat.get("recent_messages");
if(!isnull(recent_messages))
{
\tfor each recent in recent_messages
\t{
\t\ttext = recent.get("text");
\t\tif(!isnull(text))
\t\t{
\t\t\ttext = text.toString();
\t\t\trecent.put("text",text);
\t\t}
\t}
}
if(!isnull(message_details))
{
\tmessage_detail = message_details.get("message");
\tif(!isnull(message_detail))
\t{
\t\ttext = message_detail.get("text");
\t\tif(!isnull(text))
\t\t{
\t\t\ttext = text.toString();
\t\t\tmessage_detail.put("text",text);
\t\t}
\t\tcontent = message_detail.get("content");
\t\tif(!isnull(content))
\t\t{
\t\t\ttext = content.get("text");
\t\t\tif(!isnull(text))
\t\t\t{
\t\t\t\ttext = text.toString();
\t\t\t\tcontent.put("text",text);
\t\t\t\tmessage_detail.put("content",content);
\t\t\t}
\t\t}
\t\tmessage_details.put("message",message_detail);
\t}
}
payload = {"bot_unique_name":bot_name,"user":user,"message":message.toString(),"message_details":message_details,"recent_messages":recent_messages,"mentions":mentions,"attachments":attachments,"links":links,"location":location,"sender":{"name":user.get("first_name") + " " + user.get("last_name"),"id":user.get("id"),"email":user.get("email")},"chat":{"owner":chat.get("owner"),"title":chat.get("title"),"parent_resource":chat.get("parent_resource"),"id":chat.get("id"),"type":chat.get("chat_type")}};
headers = {"Content-Type":"application/json"};
try
{
\tresponse = postUrl("${WEBHOOK_URL}",payload.toString(),headers,false);
\treturn {"status":"success","text":"Processing..."};
}
catch (e)
{
\treturn {"type":"banner","status":"failure","text":"Failed to reach agent: " + e};
}`;
}

function delugeMentionHandler(botName: string): string {
  return `bot_name = "${botName}";
recent_messages = chat.get("recent_messages");
if(!isnull(recent_messages))
{
\tfor each recent in recent_messages
\t{
\t\ttext = recent.get("text");
\t\tif(!isnull(text))
\t\t{
\t\t\ttext = text.toString();
\t\t\trecent.put("text",text);
\t\t}
\t}
}
if(chat.get("chat_type") == "dm")
{
\treturn {"type":"banner","status":"success","text":"Processing..."};
}
if(!isnull(message_details))
{
\tmessage_detail = message_details.get("message");
\tif(!isnull(message_detail))
\t{
\t\ttext = message_detail.get("text");
\t\tif(!isnull(text))
\t\t{
\t\t\ttext = text.toString();
\t\t\tmessage_detail.put("text",text);
\t\t}
\t\tmessage_details.put("message",message_detail);
\t}
}
payload = {"bot_unique_name":bot_name,"user":user,"message":message.toString(),"message_details":message_details,"recent_messages":recent_messages,"mentions":mentions,"location":location,"sender":{"name":user.get("first_name") + " " + user.get("last_name"),"id":user.get("id"),"email":user.get("email")},"channel":{"name":chat.get("title")},"chat":{"owner":chat.get("owner"),"title":chat.get("title"),"parent_resource":chat.get("parent_resource"),"id":chat.get("id"),"type":"groupchat"}};
headers = {"Content-Type":"application/json"};
try
{
\tresponse = postUrl("${WEBHOOK_URL}",payload.toString(),headers,false);
\treturn {"type":"banner","status":"success","text":"Processing..."};
}
catch (e)
{
\treturn {"type":"banner","status":"failure","text":"Failed to reach agent: " + e};
}`;
}

function delugeParticipationHandler(botName: string): string {
  return `bot_name = "${botName}";
if(!isnull(data))
{
\tmsg = data.get("message");
\tif(!isnull(msg))
\t{
\t\ttext = msg.get("text");
\t\tif(!isnull(text))
\t\t{
\t\t\ttext = text.toString();
\t\t\tmsg.put("text",text);
\t\t}
\t\tdata.put("message",msg);
\t}
}
if(isnull(data))
{
\tdata = Map();
}
payload = {"bot_unique_name":bot_name,"operation":operation,"data":data,"user":user,"sender":{"name":user.get("first_name") + " " + user.get("last_name"),"id":user.get("id"),"email":user.get("email")},"chat":chat};
headers = {"Content-Type":"application/json"};
try
{
\tresponse = postUrl("${WEBHOOK_URL}",payload.toString(),headers,false);
\treturn {"type":"banner","status":"success","text":"Processing..."};
}
catch (e)
{
\treturn {"type":"banner","status":"failure","text":"Failed to reach agent: " + e};
}`;
}

function delugeButtonCallback(): string {
  return `response = Map();
button_key = "";
bot_name = "";
if(arguments.containsKey("key"))
{
\tbutton_key = arguments.get("key");
}
if(target.containsKey("bot_unique_name"))
{
\tbot_name = target.get("bot_unique_name");
}
sender_name = user.get("first_name") + " " + user.get("last_name");
sender_id = user.get("id");
sender_email = user.get("email");
chat_id = chat.get("id");
payload = Map();
payload.put("type","button_callback");
payload.put("bot_unique_name",bot_name);
payload.put("key",button_key);
sender_info = Map();
sender_info.put("name",sender_name);
sender_info.put("id",sender_id);
sender_info.put("email",sender_email);
payload.put("sender",sender_info);
chat_info = Map();
chat_info.put("id",chat_id);
payload.put("chat",chat_info);
try
{
\tresp = invokeurl
\t[
\t\turl :"${WEBHOOK_URL}"
\t\ttype :POST
\t\tparameters:payload.toString()
\t\theaders:{"Content-Type":"application/json"}
\t];
}
catch (e)
{
\tinfo "buttonCallback error: " + e;
}
parts = button_key.toList(":");
choice = button_key;
if(parts.size() > 1)
{
\tchoice = parts.get(1);
}
display_choice = choice.replaceAll("_"," ");
response.put("text","Selected: *" + display_choice + "*");
return response;`;
}

// ─── Script Display Component ───────────────────────────────────────────────

function ScriptBlock({ title, script, description }: { title: string; script: string; description: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [script]);

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <button type="button" style={{ ...btnSmall, fontFamily: "monospace" }} onClick={() => setExpanded(!expanded)}>
          {expanded ? "−" : "+"} {title}
        </button>
        <span style={muted}>{description}</span>
      </div>
      {expanded && (
        <div style={{ position: "relative", marginTop: "0.5rem" }}>
          <button
            type="button"
            style={{ ...btnSmall, position: "absolute", top: 6, right: 6, zIndex: 1, opacity: 0.8 }}
            onClick={handleCopy}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <pre style={{
            background: "var(--code-bg, rgba(0,0,0,0.3))", borderRadius: "8px", padding: "0.75rem",
            fontSize: "11px", lineHeight: "1.4", overflow: "auto", maxHeight: 300,
            border: "1px solid var(--border)", margin: 0, whiteSpace: "pre", tabSize: 2,
          }}>
            {script}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Inline Bot Setup Scripts (shown in the add-mapping form) ───────────────

function InlineBotSetup({ botName }: { botName: string }) {
  return (
    <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
      <p style={{ fontSize: "12px", margin: "0 0 0.5rem 0" }}>
        <strong>Bot Handlers</strong> — paste into your Cliq bot's handler config for <code>{botName}</code>:
      </p>
      <ScriptBlock title="message_handler" description="DM messages" script={delugeMessageHandler(botName)} />
      <ScriptBlock title="mention_handler" description="@mentions in channels" script={delugeMentionHandler(botName)} />
      <ScriptBlock title="participation_handler" description="Join/leave events" script={delugeParticipationHandler(botName)} />
      <p style={{ fontSize: "12px", margin: "0.75rem 0 0.5rem 0" }}>
        <strong>Button Callback</strong> — create in <em>Bots & Tools → Functions</em> as <code>agentChannelsCallback</code> (Button Function):
      </p>
      <ScriptBlock title="agentChannelsCallback" description="Stop button, etc." script={delugeButtonCallback()} />
    </div>
  );
}

// ─── Cliq Config (OAuth + bot mappings with inline setup) ───────────────────

function CliqConfig({ serviceId }: { serviceId: string }) {
  const { data: status } = usePluginData<ConnectionStatus>("connection-status", { serviceId });
  const serviceDef = AVAILABLE_CHANNELS.find((s) => s.type === "zoho-cliq")!;

  const { data: botMappings, refresh: refreshMappings } = usePluginData<BotMapping[]>("bot-mappings");
  const { data: companiesData } = usePluginData<{ companies: IdName[] }>("paperclip-companies");
  const saveMappingsAction = usePluginAction("save-bot-mappings");

  const [localMappings, setLocalMappings] = useState<BotMapping[]>([]);
  const [adding, setAdding] = useState(false);
  const [newBot, setNewBot] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newAgent, setNewAgent] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (botMappings && !dirty) setLocalMappings(botMappings);
  }, [botMappings, dirty]);

  const [selectedCompanyAgents, setSelectedCompanyAgents] = useState<IdName[]>([]);
  const { data: agentsData } = usePluginData<{ agents: IdName[] }>(
    "paperclip-agents",
    newCompany ? { companyId: newCompany } : undefined,
  );
  useEffect(() => {
    if (agentsData?.agents) setSelectedCompanyAgents(agentsData.agents);
  }, [agentsData]);

  const handleAddMapping = useCallback(async () => {
    if (!newBot || !newAgent || !newCompany) return;
    const updated = [...localMappings, { botUniqueName: newBot, agentId: newAgent, companyId: newCompany, enabled: true }];
    setLocalMappings(updated);
    setAdding(false);
    setNewBot(""); setNewAgent(""); setNewCompany("");
    setDirty(true);
    await saveMappingsAction({ mappings: updated });
    setDirty(false);
    refreshMappings();
  }, [newBot, newAgent, newCompany, localMappings, saveMappingsAction, refreshMappings]);

  const handleRemoveMapping = useCallback(async (botName: string) => {
    const updated = localMappings.filter((m) => m.botUniqueName !== botName);
    setLocalMappings(updated);
    setDirty(true);
    await saveMappingsAction({ mappings: updated });
    setDirty(false);
    refreshMappings();
  }, [localMappings, saveMappingsAction, refreshMappings]);

  const handleToggle = useCallback(async (botName: string) => {
    const updated = localMappings.map((m) =>
      m.botUniqueName === botName ? { ...m, enabled: !m.enabled } : m
    );
    setLocalMappings(updated);
    setDirty(true);
    await saveMappingsAction({ mappings: updated });
    setDirty(false);
    refreshMappings();
  }, [localMappings, saveMappingsAction, refreshMappings]);

  const companies = companiesData?.companies ?? [];
  const agentOptions: AutocompleteOption[] = selectedCompanyAgents.map((a) => ({ id: a.id, label: a.name }));

  return (
    <div>
      {/* OAuth Setup */}
      <OAuthSetup serviceId={serviceId} serviceDef={serviceDef} />

      {/* Bot Mappings (gated on connection) */}
      {status?.connected && (
        <div style={section}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h4 style={{ margin: 0 }}>Bot → Agent Mappings</h4>
            {!adding && (
              <button type="button" style={btnSmall} onClick={() => setAdding(true)}>+ Add</button>
            )}
          </div>
          <p style={muted}>Map each Cliq bot to a Paperclip agent. When a user DMs the bot, the message routes to that agent.</p>

          {localMappings.map((m) => (
            <div key={m.botUniqueName} style={{ ...row, padding: "4px 0" }}>
              <span style={{ flex: 1, fontSize: "13px", opacity: m.enabled ? 1 : 0.5 }}>
                <strong>{m.botUniqueName}</strong>
              </span>
              <span style={muted}>→</span>
              <span style={{ flex: 1, fontSize: "13px", opacity: m.enabled ? 1 : 0.5 }}>
                {m.agentId.slice(0, 12)}...
              </span>
              <button type="button" style={btnSmall} onClick={() => handleToggle(m.botUniqueName)}>
                {m.enabled ? "Disable" : "Enable"}
              </button>
              <button type="button" style={btnSmallDanger} onClick={() => handleRemoveMapping(m.botUniqueName)}>
                x
              </button>
            </div>
          ))}

          {adding && (
            <div style={{ ...cardStyle, padding: "0.75rem 1rem" }}>
              <div style={{ ...row, marginBottom: "0.5rem" }}>
                <input
                  style={inputStyle}
                  value={newBot}
                  onChange={(e) => setNewBot(e.target.value)}
                  placeholder="Bot unique name (e.g. jarvis_bot)"
                />
              </div>
              <div style={row}>
                <select style={selectStyle} value={newCompany} onChange={(e) => { setNewCompany(e.target.value); setNewAgent(""); }}>
                  <option value="">Select company...</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span style={muted}>→</span>
                <Autocomplete
                  options={agentOptions}
                  value={newAgent}
                  onChange={(id) => setNewAgent(id)}
                  placeholder="Search agent..."
                  disabled={!newCompany}
                />
              </div>
              {newBot && <InlineBotSetup botName={newBot} />}
              <div style={btnGroup}>
                <button type="button" style={btnPrimary} onClick={handleAddMapping} disabled={!newBot || !newAgent || !newCompany}>
                  Save
                </button>
                <button type="button" style={btn} onClick={() => { setAdding(false); setNewBot(""); setNewAgent(""); setNewCompany(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {localMappings.length === 0 && !adding && (
            <p style={muted}>No bots mapped yet. Click + Add to map a Cliq bot to a Paperclip agent.</p>
          )}
        </div>
      )}

      {status?.connected && <ServiceNotifySection serviceId={serviceId} companies={companies} />}
    </div>
  );
}

// ─── Coming Soon ────────────────────────────────────────────────────────────

function ComingSoonConfig({ serviceDef }: { serviceDef: ServiceDef }) {
  return (
    <div style={{ padding: "1rem 0" }}>
      <p style={muted}>{serviceDef.description} — coming soon.</p>
    </div>
  );
}

// ─── Per-service user notifications (Paperclip → channel user) ──────────────

type PaperclipUser = { principalId: string; membershipRole: string | null; status: string };
type CliqUser = { id: string; name: string; email?: string };
type ChannelUserMapping = { paperclipUserId: string; channelUserId: string; label?: string; enabled: boolean };
type ServiceNotify = { enabled: boolean; mappings: ChannelUserMapping[] };

/**
 * "Paperclip → User Notifications" for one channel service. Opt-in toggle plus a
 * table mapping a Paperclip user to this channel's user. Lives inside the
 * service config so each platform owns its own identity mapping (AC-6).
 */
function ServiceNotifySection({ serviceId, companies }: { serviceId: string; companies: IdName[] }) {
  const { data: notify, refresh } = usePluginData<ServiceNotify>("service-notify", { serviceId });
  const { data: cliqUsersData } = usePluginData<{ users: CliqUser[] }>("cliq-users");
  const save = usePluginAction("save-service-notify");

  const [companyId, setCompanyId] = useState("");
  const { data: pcUsersData } = usePluginData<{ users: PaperclipUser[] }>(
    "paperclip-users",
    companyId ? { companyId } : undefined,
  );

  const [enabled, setEnabled] = useState(false);
  const [mappings, setMappings] = useState<ChannelUserMapping[]>([]);
  useEffect(() => {
    if (notify) { setEnabled(!!notify.enabled); setMappings(notify.mappings ?? []); }
  }, [notify]);

  const [adding, setAdding] = useState(false);
  const [newPc, setNewPc] = useState("");
  const [newPcLabel, setNewPcLabel] = useState("");
  const [newCliq, setNewCliq] = useState("");
  const [newCliqLabel, setNewCliqLabel] = useState("");

  const cliqUsers = cliqUsersData?.users ?? [];
  const pcUsers = pcUsersData?.users ?? [];
  const cliqLabelFor = (id: string) => cliqUsers.find((u) => u.id === id)?.name ?? id;
  const pcLabelFor = (id: string) => {
    const u = pcUsers.find((x) => x.principalId === id);
    return u ? `${u.membershipRole ?? "member"} · ${id.slice(0, 8)}…` : `${id.slice(0, 12)}…`;
  };

  const pcOptions: AutocompleteOption[] = pcUsers.map((u) => ({
    id: u.principalId,
    label: `${u.membershipRole ?? "member"} · ${u.principalId.slice(0, 10)}…`,
    sublabel: u.principalId,
  }));
  const cliqOptions: AutocompleteOption[] = cliqUsers.map((u) => ({
    id: u.id, label: u.name, sublabel: u.email,
  }));

  async function persist(nextEnabled: boolean, nextMappings: ChannelUserMapping[]) {
    await save({ serviceId, config: { enabled: nextEnabled, mappings: nextMappings } });
    refresh();
  }
  async function toggle() { const v = !enabled; setEnabled(v); await persist(v, mappings); }
  function resetForm() {
    setAdding(false); setNewPc(""); setNewPcLabel(""); setNewCliq(""); setNewCliqLabel("");
  }
  async function addMapping() {
    if (!newPc || !newCliq) return;
    const next = [
      ...mappings.filter((m) => m.paperclipUserId !== newPc),
      { paperclipUserId: newPc, channelUserId: newCliq, label: newCliqLabel || cliqLabelFor(newCliq), enabled: true },
    ];
    setMappings(next);
    resetForm();
    await persist(enabled, next);
  }
  async function removeMapping(pid: string) {
    const next = mappings.filter((m) => m.paperclipUserId !== pid);
    setMappings(next);
    await persist(enabled, next);
  }

  return (
    <div style={section}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
        <h4 style={{ margin: 0 }}>Paperclip → User Notifications</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {enabled && !adding && (
            <button type="button" style={btnSmall} onClick={() => setAdding(true)}>+ Add</button>
          )}
          <label style={{ ...muted, display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={enabled} onChange={toggle} /> enabled
          </label>
        </div>
      </div>
      <p style={muted}>
        When on, Paperclip events (approvals, blocked items) are sent to the mapped
        Cliq user.
      </p>

      {enabled && (
        <>
          {mappings.map((m) => (
            <div key={m.paperclipUserId} style={{ ...row, padding: "4px 0" }}>
              <span style={{ flex: 1, fontSize: 13 }} title={m.paperclipUserId}>{pcLabelFor(m.paperclipUserId)}</span>
              <span style={muted}>→</span>
              <span style={{ flex: 1, fontSize: 13 }}>{m.label ?? cliqLabelFor(m.channelUserId)}</span>
              <button type="button" style={btnSmallDanger} onClick={() => removeMapping(m.paperclipUserId)}>x</button>
            </div>
          ))}

          {mappings.length === 0 && !adding && (
            <p style={muted}>No users mapped yet. Click + Add to notify a Paperclip user on Cliq.</p>
          )}

          {adding && (
            <div style={{ ...cardStyle, padding: "0.75rem 1rem" }}>
              <div style={{ ...row, marginBottom: "0.5rem", flexWrap: "wrap" }}>
                <select style={selectStyle} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setNewPc(""); setNewPcLabel(""); }}>
                  <option value="">Select company…</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div style={{ minWidth: 200 }}>
                  <Autocomplete
                    options={pcOptions}
                    value={newPc}
                    onChange={(id, label) => { setNewPc(id); setNewPcLabel(label); }}
                    placeholder={companyId ? "Paperclip user…" : "Select company first"}
                    disabled={!companyId}
                  />
                </div>
                <span style={muted}>→</span>
                {cliqOptions.length > 0 ? (
                  <div style={{ minWidth: 200 }}>
                    <Autocomplete
                      options={cliqOptions}
                      value={newCliq}
                      onChange={(id, label) => { setNewCliq(id); setNewCliqLabel(label); }}
                      placeholder="Search Cliq user…"
                    />
                  </div>
                ) : (
                  <input
                    style={{ ...inputStyle, minWidth: 180 }}
                    value={newCliq}
                    onChange={(e) => { setNewCliq(e.target.value); setNewCliqLabel(""); }}
                    placeholder="Cliq user id"
                  />
                )}
              </div>
              <div style={btnGroup}>
                <button type="button" style={btnPrimary} onClick={addMapping} disabled={!newPc || !newCliq}>Save</button>
                <button type="button" style={btn} onClick={resetForm}>Cancel</button>
              </div>
              {cliqOptions.length === 0 && (
                <p style={{ ...muted, marginTop: 6, marginBottom: 0 }}>
                  Cliq user lookup unavailable (needs the users-read scope) — enter the Cliq user id directly.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────

export function AgentChannelsSettingsPage(_props: PluginSettingsPageProps) {
  const { data: services, refresh: refreshServices } = usePluginData<ServiceRecord[]>("services");
  const addService = usePluginAction("add-service");
  const removeService = usePluginAction("remove-service");
  const [addingService, setAddingService] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [expandedService, setExpandedService] = useState<string | null>(null);

  // Per-service connection status for badges
  const serviceList = services ?? [];
  const [serviceStatuses, setServiceStatuses] = useState<Record<string, ConnectionStatus>>({});

  // Poll connection status for all services
  useEffect(() => {
    if (serviceList.length === 0) return;
    const poll = async () => {
      // We can't call usePluginData per service in a loop, so we rely on
      // the individual CliqConfig components to show status. The badge
      // uses a simplified check.
    };
    poll();
  }, [serviceList]);

  const handleAddService = useCallback(async () => {
    if (!selectedType) return;
    const def = AVAILABLE_CHANNELS.find((s) => s.type === selectedType);
    if (!def) return;
    await addService({ serviceType: def.type, name: def.name });
    setAddingService(false);
    setSelectedType("");
    refreshServices();
  }, [selectedType, addService, refreshServices]);

  const handleRemoveService = useCallback(async (serviceId: string) => {
    if (!confirm("Remove this channel and its configuration?")) return;
    await removeService({ serviceId });
    refreshServices();
  }, [removeService, refreshServices]);

  const configuredTypes = new Set(serviceList.map((s) => s.type));

  return (
    <div style={{ padding: "1.5rem", maxWidth: 850 }}>
      <div style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0 }}>Messaging Channels</h3>
          {!addingService && (
            <button type="button" style={btnSmall} onClick={() => setAddingService(true)}>+ Add Channel</button>
          )}
        </div>

        {addingService && (
          <div style={{ ...cardStyle, borderColor: "var(--border)" }}>
            <div style={row}>
              <select style={{ ...selectStyle, minWidth: 220 }} value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                <option value="">Select a channel...</option>
                {AVAILABLE_CHANNELS.map((s) => (
                  <option key={s.type} value={s.type} disabled={configuredTypes.has(s.type)}>
                    {s.name}{configuredTypes.has(s.type) ? " (already added)" : ""}{s.status === "coming-soon" ? " (coming soon)" : ""}
                  </option>
                ))}
              </select>
              <button type="button" style={btnPrimary} onClick={handleAddService} disabled={!selectedType}>Add</button>
              <button type="button" style={btn} onClick={() => { setAddingService(false); setSelectedType(""); }}>Cancel</button>
            </div>
            {selectedType && (
              <p style={{ ...muted, marginTop: "0.5rem", marginBottom: 0 }}>
                {AVAILABLE_CHANNELS.find((s) => s.type === selectedType)?.description}
              </p>
            )}
          </div>
        )}

        {serviceList.length === 0 && !addingService && (
          <p style={muted}>No channels connected yet. Add a channel to start routing agent conversations.</p>
        )}

        {serviceList.map((svc) => {
          const def = AVAILABLE_CHANNELS.find((d) => d.type === svc.type);
          const isExpanded = expandedService === svc.id;

          return (
            <ServiceCard
              key={svc.id}
              svc={svc}
              def={def}
              isExpanded={isExpanded}
              onToggleExpand={() => setExpandedService(isExpanded ? null : svc.id)}
              onRemove={() => handleRemoveService(svc.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Service Card with inline connection status ─────────────────────────────

function ServiceCard({ svc, def, isExpanded, onToggleExpand, onRemove }: {
  svc: ServiceRecord;
  def: ServiceDef | undefined;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRemove: () => void;
}) {
  const { data: status, refresh } = usePluginData<ConnectionStatus>("connection-status", { serviceId: svc.id });
  const isConnected = status?.connected ?? false;
  const isLoading = status === undefined || status === null;

  // Poll connection status so badge stays in sync
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    pollRef.current = setInterval(() => refresh(), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {!isLoading && <span style={dot(isConnected)} />}
          <strong style={{ fontSize: "14px" }}>{svc.name}</strong>
          <span style={badgeStyle(def?.status !== "coming-soon" && isConnected)}>
            {def?.status === "coming-soon" ? "Coming Soon" : isLoading ? "..." : isConnected ? "Connected" : "Not Connected"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" style={btnSmall} onClick={onToggleExpand}>
            {isExpanded ? "Collapse" : isConnected ? "Edit" : "Setup"}
          </button>
          <button type="button" style={btnSmallDanger} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>

      {!isExpanded && (
        <p style={{ ...muted, margin: 0 }}>{def?.description ?? svc.type}</p>
      )}

      {isExpanded && (
        def?.status === "coming-soon"
          ? <ComingSoonConfig serviceDef={def} />
          : svc.type === "zoho-cliq"
            ? <CliqConfig serviceId={svc.id} />
            : <ComingSoonConfig serviceDef={def ?? { type: svc.type, name: svc.name, description: "Unknown channel", status: "coming-soon", authType: "none" }} />
      )}
    </div>
  );
}
