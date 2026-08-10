// src/ui/index.tsx
import { useState, useCallback, useEffect, useRef } from "react";
import {
  usePluginAction,
  usePluginData
} from "@paperclipai/plugin-sdk/ui";

// src/constants.ts
var CLIQ_SCOPES = [
  "ZohoCliq.Messages.CREATE",
  "ZohoCliq.Messages.READ",
  "ZohoCliq.Messages.UPDATE",
  "ZohoCliq.Messages.DELETE",
  "ZohoCliq.Webhooks.CREATE",
  "ZohoCliq.Webhooks.UPDATE",
  "ZohoCliq.Bots.READ",
  "ZohoCliq.messageactions.READ",
  "ZohoCliq.messageactions.CREATE",
  "ZohoCliq.messageactions.DELETE",
  "ZohoCliq.Channels.READ",
  "ZohoCliq.Chats.READ",
  "ZohoCliq.Attachments.READ",
  "ZohoCliq.StorageData.ALL",
  // Org directory read — resolve Cliq user ids → display names for the
  // notify-mapping UI. Zoho's docs don't pin which scope GET /api/v2/users
  // checks, so request both (Users.READ for user APIs, Organisation.READ for
  // org-level reads); extra granted scopes are harmless. NOTE: adding these
  // requires re-consenting the Cliq OAuth connection — existing tokens won't
  // carry them.
  "ZohoCliq.Users.READ",
  "ZohoCliq.Organisation.READ"
].join(",");

// src/ui/index.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var btn = {
  appearance: "none",
  border: "1px solid var(--border)",
  borderRadius: "999px",
  background: "transparent",
  color: "inherit",
  padding: "6px 14px",
  fontSize: "12px",
  cursor: "pointer"
};
var btnPrimary = { ...btn, background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" };
var btnDanger = { ...btn, color: "var(--destructive, #dc2626)", borderColor: "var(--destructive, #dc2626)" };
var btnSmall = { ...btn, padding: "4px 10px", fontSize: "11px" };
var btnSmallDanger = { ...btnDanger, padding: "4px 10px", fontSize: "11px" };
var inputStyle = {
  flex: 1,
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "8px 10px",
  background: "transparent",
  color: "inherit",
  fontSize: "12px",
  minWidth: 0
};
var selectStyle = { ...inputStyle, cursor: "pointer", minWidth: 160 };
var section = { marginBottom: "1.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "1.25rem" };
var row = { display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center" };
var btnGroup = { display: "flex", gap: "0.5rem", marginTop: "0.75rem" };
var muted = { fontSize: "12px", color: "var(--muted-foreground, #888)" };
var dot = (ok) => ({
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: ok ? "var(--success, #22c55e)" : "var(--destructive, #dc2626)",
  marginRight: 6
});
var cardStyle = {
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "1rem 1.25rem",
  marginBottom: "1rem",
  background: "var(--card, transparent)"
};
var cardHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "0.75rem"
};
var badgeStyle = (active) => ({
  fontSize: "10px",
  padding: "2px 8px",
  borderRadius: "999px",
  background: active ? "var(--success, #22c55e)" : "var(--muted, #666)",
  color: "#fff",
  textTransform: "uppercase",
  letterSpacing: "0.5px"
});
var AVAILABLE_CHANNELS = [
  {
    type: "zoho-cliq",
    name: "Zoho Cliq",
    description: "Agent chat through Zoho Cliq bots",
    status: "available",
    authType: "oauth",
    provider: "zoho",
    // Single source of truth — kept in sync with the worker's CLIQ_SCOPES so
    // the consent URL always requests exactly what the bot uses (incl. the
    // org/users-read scopes for name resolution).
    scopes: CLIQ_SCOPES
  },
  { type: "microsoft-teams", name: "Microsoft Teams", description: "Bot conversations in Teams", status: "coming-soon", authType: "oauth", provider: "microsoft" },
  { type: "discord", name: "Discord", description: "Bot commands in Discord servers", status: "coming-soon", authType: "oauth", provider: "discord" },
  { type: "slack", name: "Slack", description: "Bot conversations in Slack workspaces", status: "coming-soon", authType: "oauth", provider: "slack" }
];
function Autocomplete({
  options,
  value,
  onChange,
  placeholder,
  disabled
}) {
  const [query, setQuery] = useState(value ? options.find((o) => o.id === value)?.label ?? "" : "");
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const wrapRef = useRef(null);
  const filtered = (query.length === 0 ? options : options.filter(
    (o) => o.label.toLowerCase().includes(query.toLowerCase()) || (o.sublabel?.toLowerCase().includes(query.toLowerCase()) ?? false)
  )).filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i);
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
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
  const select = (opt) => {
    setQuery(opt.label);
    setOpen(false);
    setFocusIdx(-1);
    onChange(opt.id, opt.label);
  };
  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && focusIdx >= 0 && filtered[focusIdx]) {
      e.preventDefault();
      select(filtered[focusIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };
  return /* @__PURE__ */ jsxs("div", { ref: wrapRef, style: { position: "relative", flex: 1, minWidth: 0 }, children: [
    /* @__PURE__ */ jsx(
      "input",
      {
        style: inputStyle,
        placeholder,
        value: query,
        disabled,
        onChange: (e) => {
          setQuery(e.target.value);
          setOpen(true);
          setFocusIdx(-1);
        },
        onFocus: () => setOpen(true),
        onKeyDown: handleKeyDown
      }
    ),
    open && filtered.length > 0 && /* @__PURE__ */ jsx("div", { style: {
      position: "absolute",
      top: "100%",
      left: 0,
      right: 0,
      zIndex: 50,
      maxHeight: 200,
      overflowY: "auto",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      background: "var(--popover, var(--background, #1a1a1a))",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      marginTop: 2
    }, children: filtered.map((opt, i) => /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          padding: "6px 10px",
          cursor: "pointer",
          fontSize: "12px",
          background: i === focusIdx ? "var(--accent, rgba(255,255,255,0.1))" : "transparent"
        },
        onMouseEnter: () => setFocusIdx(i),
        onMouseDown: (e) => {
          e.preventDefault();
          select(opt);
        },
        children: [
          opt.label,
          opt.sublabel && /* @__PURE__ */ jsx("span", { style: { ...muted, marginLeft: 6 }, children: opt.sublabel })
        ]
      },
      opt.id
    )) }),
    open && filtered.length === 0 && query.length > 0 && /* @__PURE__ */ jsx("div", { style: {
      position: "absolute",
      top: "100%",
      left: 0,
      right: 0,
      zIndex: 50,
      padding: "8px 10px",
      fontSize: "12px",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      background: "var(--popover, var(--background, #1a1a1a))",
      color: "var(--muted-foreground, #888)",
      marginTop: 2
    }, children: "No matches" })
  ] });
}
function OAuthSetup({ serviceId, serviceDef, companyId }) {
  const { data: status, refresh } = usePluginData("connection-status", { serviceId, companyId });
  const { data: connectData, refresh: refreshConnectUrl } = usePluginData("connect-url", { serviceId, companyId, scopes: serviceDef.scopes ?? "" });
  const saveOAuthConfig = usePluginAction("save-service-oauth-config");
  const disconnectAction = usePluginAction("disconnect-service");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("https://cortex.neoreef.com/oauth/callback");
  const [dataCenter, setDataCenter] = useState("US");
  const [configSaved, setConfigSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef(null);
  useEffect(() => {
    if (!status?.connected) {
      pollRef.current = setInterval(() => refresh(), 3e3);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status?.connected, refresh]);
  const handleSaveConfig = useCallback(async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      await saveOAuthConfig({ serviceId, companyId, clientId, clientSecret, callbackUrl, dataCenter });
      setConfigSaved(true);
      setTimeout(() => {
        refresh();
        refreshConnectUrl();
      }, 500);
    } catch (e) {
      console.error("Failed to save OAuth config:", e);
    } finally {
      setSaving(false);
    }
  }, [serviceId, companyId, clientId, clientSecret, callbackUrl, dataCenter, saveOAuthConfig, refresh, refreshConnectUrl]);
  const handleDisconnect = useCallback(async () => {
    if (confirm("Disconnect this service? You will need to re-authenticate.")) {
      await disconnectAction({ serviceId, companyId });
      refresh();
    }
  }, [serviceId, companyId, disconnectAction, refresh]);
  if (status?.connected) {
    return /* @__PURE__ */ jsxs("div", { style: { ...section, paddingTop: "0.5rem" }, children: [
      /* @__PURE__ */ jsx("h4", { style: { marginTop: 0 }, children: "Connection" }),
      /* @__PURE__ */ jsxs("p", { style: { margin: "0.25rem 0" }, children: [
        /* @__PURE__ */ jsx("span", { style: dot(status.tokenValid) }),
        "Connected (",
        status.dataCenter,
        ")",
        " ",
        /* @__PURE__ */ jsxs("span", { style: muted, children: [
          status.tokenValid ? "Token valid" : "Token expired",
          status.tokenExpiresAt && ` \u2014 expires ${new Date(status.tokenExpiresAt).toLocaleString()}`
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: btnGroup, children: [
        connectData?.configured && /* @__PURE__ */ jsx("a", { href: connectData.connectUrl, target: "_blank", rel: "noopener", style: { textDecoration: "none" }, children: /* @__PURE__ */ jsx("button", { type: "button", style: btn, children: "Reconnect" }) }),
        /* @__PURE__ */ jsx("button", { type: "button", style: btnDanger, onClick: handleDisconnect, children: "Disconnect" })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { style: { ...section, paddingTop: "0.5rem" }, children: [
    /* @__PURE__ */ jsx("h4", { style: { marginTop: 0 }, children: "Connection" }),
    /* @__PURE__ */ jsxs("p", { style: muted, children: [
      "Enter your ",
      serviceDef.provider === "zoho" ? "Zoho API Console" : serviceDef.name,
      " OAuth credentials."
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: "0.5rem", marginTop: "0.75rem" }, children: [
      /* @__PURE__ */ jsxs("div", { style: row, children: [
        /* @__PURE__ */ jsx("label", { style: { width: 110, fontSize: "12px", flexShrink: 0 }, children: "Client ID" }),
        /* @__PURE__ */ jsx("input", { style: inputStyle, value: clientId, onChange: (e) => {
          setClientId(e.target.value);
          setConfigSaved(false);
        }, placeholder: "Client ID" })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: row, children: [
        /* @__PURE__ */ jsx("label", { style: { width: 110, fontSize: "12px", flexShrink: 0 }, children: "Client Secret" }),
        /* @__PURE__ */ jsx("input", { style: inputStyle, type: "password", value: clientSecret, onChange: (e) => {
          setClientSecret(e.target.value);
          setConfigSaved(false);
        }, placeholder: "Client secret" })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: row, children: [
        /* @__PURE__ */ jsx("label", { style: { width: 110, fontSize: "12px", flexShrink: 0 }, children: "Callback URL" }),
        /* @__PURE__ */ jsx("input", { style: inputStyle, value: callbackUrl, onChange: (e) => {
          setCallbackUrl(e.target.value);
          setConfigSaved(false);
        } })
      ] }),
      serviceDef.provider === "zoho" && /* @__PURE__ */ jsxs("div", { style: row, children: [
        /* @__PURE__ */ jsx("label", { style: { width: 110, fontSize: "12px", flexShrink: 0 }, children: "Data Center" }),
        /* @__PURE__ */ jsx("select", { style: { ...selectStyle, flex: 0, minWidth: 80 }, value: dataCenter, onChange: (e) => {
          setDataCenter(e.target.value);
          setConfigSaved(false);
        }, children: ["US", "EU", "IN", "AU", "JP", "CA"].map((dc) => /* @__PURE__ */ jsx("option", { value: dc, children: dc }, dc)) })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { style: btnGroup, children: !configSaved ? /* @__PURE__ */ jsx("button", { type: "button", style: btnPrimary, onClick: handleSaveConfig, disabled: !clientId || saving, children: saving ? "Saving..." : "Save & Continue" }) : connectData?.configured ? /* @__PURE__ */ jsx("a", { href: connectData.connectUrl, target: "_blank", rel: "noopener", style: { textDecoration: "none" }, children: /* @__PURE__ */ jsxs("button", { type: "button", style: btnPrimary, children: [
      "Connect to ",
      serviceDef.name
    ] }) }) : /* @__PURE__ */ jsx("button", { type: "button", style: btnPrimary, onClick: () => refresh(), children: "Loading connect URL... (click to retry)" }) })
  ] });
}
var WEBHOOK_URL = "https://cortex.neoreef.com/cliq";
function delugeMessageHandler(botName) {
  return `bot_name = "${botName}";
recent_messages = chat.get("recent_messages");
if(!isnull(recent_messages))
{
	for each recent in recent_messages
	{
		text = recent.get("text");
		if(!isnull(text))
		{
			text = text.toString();
			recent.put("text",text);
		}
	}
}
if(!isnull(message_details))
{
	message_detail = message_details.get("message");
	if(!isnull(message_detail))
	{
		text = message_detail.get("text");
		if(!isnull(text))
		{
			text = text.toString();
			message_detail.put("text",text);
		}
		content = message_detail.get("content");
		if(!isnull(content))
		{
			text = content.get("text");
			if(!isnull(text))
			{
				text = text.toString();
				content.put("text",text);
				message_detail.put("content",content);
			}
		}
		message_details.put("message",message_detail);
	}
}
payload = {"bot_unique_name":bot_name,"user":user,"message":message.toString(),"message_details":message_details,"recent_messages":recent_messages,"mentions":mentions,"attachments":attachments,"links":links,"location":location,"sender":{"name":user.get("first_name") + " " + user.get("last_name"),"id":user.get("id"),"email":user.get("email")},"chat":{"owner":chat.get("owner"),"title":chat.get("title"),"parent_resource":chat.get("parent_resource"),"id":chat.get("id"),"type":chat.get("chat_type")}};
headers = {"Content-Type":"application/json"};
try
{
	response = postUrl("${WEBHOOK_URL}",payload.toString(),headers,false);
	return {"status":"success","text":"Processing..."};
}
catch (e)
{
	return {"type":"banner","status":"failure","text":"Failed to reach agent: " + e};
}`;
}
function delugeMentionHandler(botName) {
  return `bot_name = "${botName}";
recent_messages = chat.get("recent_messages");
if(!isnull(recent_messages))
{
	for each recent in recent_messages
	{
		text = recent.get("text");
		if(!isnull(text))
		{
			text = text.toString();
			recent.put("text",text);
		}
	}
}
if(chat.get("chat_type") == "dm")
{
	return {"type":"banner","status":"success","text":"Processing..."};
}
if(!isnull(message_details))
{
	message_detail = message_details.get("message");
	if(!isnull(message_detail))
	{
		text = message_detail.get("text");
		if(!isnull(text))
		{
			text = text.toString();
			message_detail.put("text",text);
		}
		message_details.put("message",message_detail);
	}
}
payload = {"bot_unique_name":bot_name,"user":user,"message":message.toString(),"message_details":message_details,"recent_messages":recent_messages,"mentions":mentions,"location":location,"sender":{"name":user.get("first_name") + " " + user.get("last_name"),"id":user.get("id"),"email":user.get("email")},"channel":{"name":chat.get("title")},"chat":{"owner":chat.get("owner"),"title":chat.get("title"),"parent_resource":chat.get("parent_resource"),"id":chat.get("id"),"type":"groupchat"}};
headers = {"Content-Type":"application/json"};
try
{
	response = postUrl("${WEBHOOK_URL}",payload.toString(),headers,false);
	return {"type":"banner","status":"success","text":"Processing..."};
}
catch (e)
{
	return {"type":"banner","status":"failure","text":"Failed to reach agent: " + e};
}`;
}
function delugeParticipationHandler(botName) {
  return `bot_name = "${botName}";
if(!isnull(data))
{
	msg = data.get("message");
	if(!isnull(msg))
	{
		text = msg.get("text");
		if(!isnull(text))
		{
			text = text.toString();
			msg.put("text",text);
		}
		data.put("message",msg);
	}
}
if(isnull(data))
{
	data = Map();
}
payload = {"bot_unique_name":bot_name,"operation":operation,"data":data,"user":user,"sender":{"name":user.get("first_name") + " " + user.get("last_name"),"id":user.get("id"),"email":user.get("email")},"chat":chat};
headers = {"Content-Type":"application/json"};
try
{
	response = postUrl("${WEBHOOK_URL}",payload.toString(),headers,false);
	return {"type":"banner","status":"success","text":"Processing..."};
}
catch (e)
{
	return {"type":"banner","status":"failure","text":"Failed to reach agent: " + e};
}`;
}
function delugeButtonCallback() {
  return `response = Map();
button_key = "";
bot_name = "";
if(arguments.containsKey("key"))
{
	button_key = arguments.get("key");
}
if(target.containsKey("bot_unique_name"))
{
	bot_name = target.get("bot_unique_name");
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
	resp = invokeurl
	[
		url :"${WEBHOOK_URL}"
		type :POST
		parameters:payload.toString()
		headers:{"Content-Type":"application/json"}
	];
}
catch (e)
{
	info "buttonCallback error: " + e;
}
parts = button_key.toList(":");
choice = button_key;
if(parts.size() > 1)
{
	choice = parts.get(1);
}
display_choice = choice.replaceAll("_"," ");
response.put("text","Selected: *" + display_choice + "*");
return response;`;
}
function ScriptBlock({ title, script, description }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    }).catch(() => {
    });
  }, [script]);
  return /* @__PURE__ */ jsxs("div", { style: { marginBottom: "0.75rem" }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" }, children: [
      /* @__PURE__ */ jsxs("button", { type: "button", style: { ...btnSmall, fontFamily: "monospace" }, onClick: () => setExpanded(!expanded), children: [
        expanded ? "\u2212" : "+",
        " ",
        title
      ] }),
      /* @__PURE__ */ jsx("span", { style: muted, children: description })
    ] }),
    expanded && /* @__PURE__ */ jsxs("div", { style: { position: "relative", marginTop: "0.5rem" }, children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          style: { ...btnSmall, position: "absolute", top: 6, right: 6, zIndex: 1, opacity: 0.8 },
          onClick: handleCopy,
          children: copied ? "Copied" : "Copy"
        }
      ),
      /* @__PURE__ */ jsx("pre", { style: {
        background: "var(--code-bg, rgba(0,0,0,0.3))",
        borderRadius: "8px",
        padding: "0.75rem",
        fontSize: "11px",
        lineHeight: "1.4",
        overflow: "auto",
        maxHeight: 300,
        border: "1px solid var(--border)",
        margin: 0,
        whiteSpace: "pre",
        tabSize: 2
      }, children: script })
    ] })
  ] });
}
function InlineBotSetup({ botName }) {
  return /* @__PURE__ */ jsxs("div", { style: { marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }, children: [
    /* @__PURE__ */ jsxs("p", { style: { fontSize: "12px", margin: "0 0 0.5rem 0" }, children: [
      /* @__PURE__ */ jsx("strong", { children: "Bot Handlers" }),
      " \u2014 paste into your Cliq bot's handler config for ",
      /* @__PURE__ */ jsx("code", { children: botName }),
      ":"
    ] }),
    /* @__PURE__ */ jsx(ScriptBlock, { title: "message_handler", description: "DM messages", script: delugeMessageHandler(botName) }),
    /* @__PURE__ */ jsx(ScriptBlock, { title: "mention_handler", description: "@mentions in channels", script: delugeMentionHandler(botName) }),
    /* @__PURE__ */ jsx(ScriptBlock, { title: "participation_handler", description: "Join/leave events", script: delugeParticipationHandler(botName) }),
    /* @__PURE__ */ jsxs("p", { style: { fontSize: "12px", margin: "0.75rem 0 0.5rem 0" }, children: [
      /* @__PURE__ */ jsx("strong", { children: "Button Callback" }),
      " \u2014 create in ",
      /* @__PURE__ */ jsx("em", { children: "Bots & Tools \u2192 Functions" }),
      " as ",
      /* @__PURE__ */ jsx("code", { children: "agentChannelsCallback" }),
      " (Button Function):"
    ] }),
    /* @__PURE__ */ jsx(ScriptBlock, { title: "agentChannelsCallback", description: "Stop button, etc.", script: delugeButtonCallback() })
  ] });
}
function CliqConfig({ serviceId, companyId }) {
  const { data: status } = usePluginData("connection-status", { serviceId, companyId });
  const serviceDef = AVAILABLE_CHANNELS.find((s) => s.type === "zoho-cliq");
  const { data: botMappings, refresh: refreshMappings } = usePluginData("bot-mappings");
  const { data: companiesData } = usePluginData("paperclip-companies");
  const saveMappingsAction = usePluginAction("save-bot-mappings");
  const [localMappings, setLocalMappings] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newBot, setNewBot] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newAgent, setNewAgent] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (botMappings && !dirty) setLocalMappings(botMappings);
  }, [botMappings, dirty]);
  const [selectedCompanyAgents, setSelectedCompanyAgents] = useState([]);
  const { data: agentsData } = usePluginData(
    "paperclip-agents",
    newCompany ? { companyId: newCompany } : void 0
  );
  useEffect(() => {
    if (agentsData?.agents) setSelectedCompanyAgents(agentsData.agents);
  }, [agentsData]);
  const handleAddMapping = useCallback(async () => {
    if (!newBot || !newAgent || !newCompany) return;
    const updated = [...localMappings, { botUniqueName: newBot, agentId: newAgent, companyId: newCompany, enabled: true }];
    setLocalMappings(updated);
    setAdding(false);
    setNewBot("");
    setNewAgent("");
    setNewCompany("");
    setDirty(true);
    await saveMappingsAction({ mappings: updated });
    setDirty(false);
    refreshMappings();
  }, [newBot, newAgent, newCompany, localMappings, saveMappingsAction, refreshMappings]);
  const handleRemoveMapping = useCallback(async (botName) => {
    const updated = localMappings.filter((m) => m.botUniqueName !== botName);
    setLocalMappings(updated);
    setDirty(true);
    await saveMappingsAction({ mappings: updated });
    setDirty(false);
    refreshMappings();
  }, [localMappings, saveMappingsAction, refreshMappings]);
  const handleToggle = useCallback(async (botName) => {
    const updated = localMappings.map(
      (m) => m.botUniqueName === botName ? { ...m, enabled: !m.enabled } : m
    );
    setLocalMappings(updated);
    setDirty(true);
    await saveMappingsAction({ mappings: updated });
    setDirty(false);
    refreshMappings();
  }, [localMappings, saveMappingsAction, refreshMappings]);
  const companies = companiesData?.companies ?? [];
  const agentOptions = selectedCompanyAgents.map((a) => ({ id: a.id, label: a.name }));
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx(OAuthSetup, { serviceId, serviceDef, companyId }),
    status?.connected && /* @__PURE__ */ jsxs("div", { style: section, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }, children: [
        /* @__PURE__ */ jsx("h4", { style: { margin: 0 }, children: "Bot \u2192 Agent Mappings" }),
        !adding && /* @__PURE__ */ jsx("button", { type: "button", style: btnSmall, onClick: () => setAdding(true), children: "+ Add" })
      ] }),
      /* @__PURE__ */ jsx("p", { style: muted, children: "Map each Cliq bot to a Paperclip agent. When a user DMs the bot, the message routes to that agent." }),
      localMappings.map((m) => /* @__PURE__ */ jsxs("div", { style: { ...row, padding: "4px 0" }, children: [
        /* @__PURE__ */ jsx("span", { style: { flex: 1, fontSize: "13px", opacity: m.enabled ? 1 : 0.5 }, children: /* @__PURE__ */ jsx("strong", { children: m.botUniqueName }) }),
        /* @__PURE__ */ jsx("span", { style: muted, children: "\u2192" }),
        /* @__PURE__ */ jsxs("span", { style: { flex: 1, fontSize: "13px", opacity: m.enabled ? 1 : 0.5 }, children: [
          m.agentId.slice(0, 12),
          "..."
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", style: btnSmall, onClick: () => handleToggle(m.botUniqueName), children: m.enabled ? "Disable" : "Enable" }),
        /* @__PURE__ */ jsx("button", { type: "button", style: btnSmallDanger, onClick: () => handleRemoveMapping(m.botUniqueName), children: "x" })
      ] }, m.botUniqueName)),
      adding && /* @__PURE__ */ jsxs("div", { style: { ...cardStyle, padding: "0.75rem 1rem" }, children: [
        /* @__PURE__ */ jsx("div", { style: { ...row, marginBottom: "0.5rem" }, children: /* @__PURE__ */ jsx(
          "input",
          {
            style: inputStyle,
            value: newBot,
            onChange: (e) => setNewBot(e.target.value),
            placeholder: "Bot unique name (e.g. jarvis_bot)"
          }
        ) }),
        /* @__PURE__ */ jsxs("div", { style: row, children: [
          /* @__PURE__ */ jsxs("select", { style: selectStyle, value: newCompany, onChange: (e) => {
            setNewCompany(e.target.value);
            setNewAgent("");
          }, children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "Select company..." }),
            companies.map((c) => /* @__PURE__ */ jsx("option", { value: c.id, children: c.name }, c.id))
          ] }),
          /* @__PURE__ */ jsx("span", { style: muted, children: "\u2192" }),
          /* @__PURE__ */ jsx(
            Autocomplete,
            {
              options: agentOptions,
              value: newAgent,
              onChange: (id) => setNewAgent(id),
              placeholder: "Search agent...",
              disabled: !newCompany
            }
          )
        ] }),
        newBot && /* @__PURE__ */ jsx(InlineBotSetup, { botName: newBot }),
        /* @__PURE__ */ jsxs("div", { style: btnGroup, children: [
          /* @__PURE__ */ jsx("button", { type: "button", style: btnPrimary, onClick: handleAddMapping, disabled: !newBot || !newAgent || !newCompany, children: "Save" }),
          /* @__PURE__ */ jsx("button", { type: "button", style: btn, onClick: () => {
            setAdding(false);
            setNewBot("");
            setNewAgent("");
            setNewCompany("");
          }, children: "Cancel" })
        ] })
      ] }),
      localMappings.length === 0 && !adding && /* @__PURE__ */ jsx("p", { style: muted, children: "No bots mapped yet. Click + Add to map a Cliq bot to a Paperclip agent." })
    ] }),
    status?.connected && /* @__PURE__ */ jsx(ServiceNotifySection, { serviceId, scopeCompanyId: companyId, companies })
  ] });
}
function ComingSoonConfig({ serviceDef }) {
  return /* @__PURE__ */ jsx("div", { style: { padding: "1rem 0" }, children: /* @__PURE__ */ jsxs("p", { style: muted, children: [
    serviceDef.description,
    " \u2014 coming soon."
  ] }) });
}
function ServiceNotifySection({ serviceId, scopeCompanyId, companies }) {
  const { data: notify, refresh } = usePluginData("service-notify", { serviceId, companyId: scopeCompanyId });
  const { data: cliqUsersData } = usePluginData("cliq-users", { serviceId, companyId: scopeCompanyId });
  const save = usePluginAction("save-service-notify");
  const [companyId, setCompanyId] = useState(scopeCompanyId);
  useEffect(() => {
    setCompanyId(scopeCompanyId);
  }, [scopeCompanyId]);
  const { data: pcUsersData } = usePluginData(
    "paperclip-users",
    companyId ? { companyId } : void 0
  );
  const [enabled, setEnabled] = useState(false);
  const [mappings, setMappings] = useState([]);
  useEffect(() => {
    if (notify) {
      setEnabled(!!notify.enabled);
      setMappings(notify.mappings ?? []);
    }
  }, [notify]);
  const [adding, setAdding] = useState(false);
  const [newPc, setNewPc] = useState("");
  const [newPcLabel, setNewPcLabel] = useState("");
  const [newCliq, setNewCliq] = useState("");
  const [newCliqLabel, setNewCliqLabel] = useState("");
  const cliqUsers = cliqUsersData?.users ?? [];
  const pcUsers = pcUsersData?.users ?? [];
  const cliqLabelFor = (id) => cliqUsers.find((u) => u.id === id)?.name ?? id;
  const pcLabelFor = (id) => {
    const u = pcUsers.find((x) => x.principalId === id);
    return u ? `${u.membershipRole ?? "member"} \xB7 ${id.slice(0, 8)}\u2026` : `${id.slice(0, 12)}\u2026`;
  };
  const pcOptions = pcUsers.map((u) => ({
    id: u.principalId,
    label: `${u.membershipRole ?? "member"} \xB7 ${u.principalId.slice(0, 10)}\u2026`,
    sublabel: u.principalId
  }));
  const cliqOptions = cliqUsers.map((u) => ({
    id: u.id,
    label: u.name,
    sublabel: u.email
  }));
  async function persist(nextEnabled, nextMappings) {
    await save({ serviceId, companyId: scopeCompanyId, config: { enabled: nextEnabled, mappings: nextMappings } });
    refresh();
  }
  async function toggle() {
    const v = !enabled;
    setEnabled(v);
    await persist(v, mappings);
  }
  function resetForm() {
    setAdding(false);
    setNewPc("");
    setNewPcLabel("");
    setNewCliq("");
    setNewCliqLabel("");
  }
  async function addMapping() {
    if (!newPc || !newCliq) return;
    const next = [
      ...mappings.filter((m) => m.paperclipUserId !== newPc),
      { paperclipUserId: newPc, channelUserId: newCliq, label: newCliqLabel || cliqLabelFor(newCliq), enabled: true }
    ];
    setMappings(next);
    resetForm();
    await persist(enabled, next);
  }
  async function removeMapping(pid) {
    const next = mappings.filter((m) => m.paperclipUserId !== pid);
    setMappings(next);
    await persist(enabled, next);
  }
  return /* @__PURE__ */ jsxs("div", { style: section, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }, children: [
      /* @__PURE__ */ jsx("h4", { style: { margin: 0 }, children: "Paperclip \u2192 User Notifications" }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [
        enabled && !adding && /* @__PURE__ */ jsx("button", { type: "button", style: btnSmall, onClick: () => setAdding(true), children: "+ Add" }),
        /* @__PURE__ */ jsxs("label", { style: { ...muted, display: "flex", alignItems: "center", gap: 4 }, children: [
          /* @__PURE__ */ jsx("input", { type: "checkbox", checked: enabled, onChange: toggle }),
          " enabled"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx("p", { style: muted, children: "When on, Paperclip events (approvals, blocked items) are sent to the mapped Cliq user." }),
    enabled && /* @__PURE__ */ jsxs(Fragment, { children: [
      mappings.map((m) => /* @__PURE__ */ jsxs("div", { style: { ...row, padding: "4px 0" }, children: [
        /* @__PURE__ */ jsx("span", { style: { flex: 1, fontSize: 13 }, title: m.paperclipUserId, children: pcLabelFor(m.paperclipUserId) }),
        /* @__PURE__ */ jsx("span", { style: muted, children: "\u2192" }),
        /* @__PURE__ */ jsx("span", { style: { flex: 1, fontSize: 13 }, children: m.label ?? cliqLabelFor(m.channelUserId) }),
        /* @__PURE__ */ jsx("button", { type: "button", style: btnSmallDanger, onClick: () => removeMapping(m.paperclipUserId), children: "x" })
      ] }, m.paperclipUserId)),
      mappings.length === 0 && !adding && /* @__PURE__ */ jsx("p", { style: muted, children: "No users mapped yet. Click + Add to notify a Paperclip user on Cliq." }),
      adding && /* @__PURE__ */ jsxs("div", { style: { ...cardStyle, padding: "0.75rem 1rem" }, children: [
        /* @__PURE__ */ jsxs("div", { style: { ...row, marginBottom: "0.5rem", flexWrap: "wrap" }, children: [
          /* @__PURE__ */ jsxs("select", { style: selectStyle, value: companyId, onChange: (e) => {
            setCompanyId(e.target.value);
            setNewPc("");
            setNewPcLabel("");
          }, children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "Select company\u2026" }),
            companies.map((c) => /* @__PURE__ */ jsx("option", { value: c.id, children: c.name }, c.id))
          ] }),
          /* @__PURE__ */ jsx("div", { style: { minWidth: 200 }, children: /* @__PURE__ */ jsx(
            Autocomplete,
            {
              options: pcOptions,
              value: newPc,
              onChange: (id, label) => {
                setNewPc(id);
                setNewPcLabel(label);
              },
              placeholder: companyId ? "Paperclip user\u2026" : "Select company first",
              disabled: !companyId
            }
          ) }),
          /* @__PURE__ */ jsx("span", { style: muted, children: "\u2192" }),
          cliqOptions.length > 0 ? /* @__PURE__ */ jsx("div", { style: { minWidth: 200 }, children: /* @__PURE__ */ jsx(
            Autocomplete,
            {
              options: cliqOptions,
              value: newCliq,
              onChange: (id, label) => {
                setNewCliq(id);
                setNewCliqLabel(label);
              },
              placeholder: "Search Cliq user\u2026"
            }
          ) }) : /* @__PURE__ */ jsx(
            "input",
            {
              style: { ...inputStyle, minWidth: 180 },
              value: newCliq,
              onChange: (e) => {
                setNewCliq(e.target.value);
                setNewCliqLabel("");
              },
              placeholder: "Cliq user id"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { style: btnGroup, children: [
          /* @__PURE__ */ jsx("button", { type: "button", style: btnPrimary, onClick: addMapping, disabled: !newPc || !newCliq, children: "Save" }),
          /* @__PURE__ */ jsx("button", { type: "button", style: btn, onClick: resetForm, children: "Cancel" })
        ] }),
        cliqOptions.length === 0 && /* @__PURE__ */ jsx("p", { style: { ...muted, marginTop: 6, marginBottom: 0 }, children: "Cliq user lookup unavailable (needs the users-read scope) \u2014 enter the Cliq user id directly." })
      ] })
    ] })
  ] });
}
function AgentChannelsSettingsPage(_props) {
  const { data: companiesData } = usePluginData("paperclip-companies");
  const companies = companiesData?.companies ?? [];
  const [companyId, setCompanyId] = useState("");
  useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id);
  }, [companies, companyId]);
  const servicesParams = companyId ? { companyId } : void 0;
  const { data: services, refresh: refreshServices } = usePluginData("services", servicesParams);
  const addService = usePluginAction("add-service");
  const removeService = usePluginAction("remove-service");
  const [addingService, setAddingService] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [expandedService, setExpandedService] = useState(null);
  const serviceList = services ?? [];
  const handleAddService = useCallback(async () => {
    if (!selectedType || !companyId) return;
    const def = AVAILABLE_CHANNELS.find((s) => s.type === selectedType);
    if (!def) return;
    await addService({ serviceType: def.type, name: def.name, companyId });
    setAddingService(false);
    setSelectedType("");
    refreshServices();
  }, [selectedType, companyId, addService, refreshServices]);
  const handleRemoveService = useCallback(async (serviceId) => {
    if (!confirm("Remove this channel and its configuration?")) return;
    await removeService({ serviceId, companyId });
    refreshServices();
  }, [removeService, companyId, refreshServices]);
  const configuredTypes = new Set(serviceList.map((s) => s.type));
  return /* @__PURE__ */ jsx("div", { style: { padding: "1.5rem", maxWidth: 850 }, children: /* @__PURE__ */ jsxs("div", { style: section, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }, children: [
      /* @__PURE__ */ jsx("h3", { style: { margin: 0 }, children: "Messaging Channels" }),
      !addingService && /* @__PURE__ */ jsx("button", { type: "button", style: btnSmall, onClick: () => setAddingService(true), disabled: !companyId, children: "+ Add Channel" })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { ...row, marginBottom: "1rem" }, children: [
      /* @__PURE__ */ jsx("label", { style: { fontSize: "12px", flexShrink: 0 }, children: "Company" }),
      /* @__PURE__ */ jsxs(
        "select",
        {
          style: { ...selectStyle, minWidth: 240 },
          value: companyId,
          onChange: (e) => {
            setCompanyId(e.target.value);
            setExpandedService(null);
          },
          children: [
            companies.length === 0 && /* @__PURE__ */ jsx("option", { value: "", children: "Loading companies\u2026" }),
            companies.map((c) => /* @__PURE__ */ jsx("option", { value: c.id, children: c.name }, c.id))
          ]
        }
      ),
      /* @__PURE__ */ jsx("span", { style: muted, children: "Each company connects its own Zoho org independently." })
    ] }),
    addingService && /* @__PURE__ */ jsxs("div", { style: { ...cardStyle, borderColor: "var(--border)" }, children: [
      /* @__PURE__ */ jsxs("div", { style: row, children: [
        /* @__PURE__ */ jsxs("select", { style: { ...selectStyle, minWidth: 220 }, value: selectedType, onChange: (e) => setSelectedType(e.target.value), children: [
          /* @__PURE__ */ jsx("option", { value: "", children: "Select a channel..." }),
          AVAILABLE_CHANNELS.map((s) => /* @__PURE__ */ jsxs("option", { value: s.type, disabled: configuredTypes.has(s.type), children: [
            s.name,
            configuredTypes.has(s.type) ? " (already added)" : "",
            s.status === "coming-soon" ? " (coming soon)" : ""
          ] }, s.type))
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", style: btnPrimary, onClick: handleAddService, disabled: !selectedType, children: "Add" }),
        /* @__PURE__ */ jsx("button", { type: "button", style: btn, onClick: () => {
          setAddingService(false);
          setSelectedType("");
        }, children: "Cancel" })
      ] }),
      selectedType && /* @__PURE__ */ jsx("p", { style: { ...muted, marginTop: "0.5rem", marginBottom: 0 }, children: AVAILABLE_CHANNELS.find((s) => s.type === selectedType)?.description })
    ] }),
    serviceList.length === 0 && !addingService && /* @__PURE__ */ jsx("p", { style: muted, children: "No channels connected yet. Add a channel to start routing agent conversations." }),
    serviceList.map((svc) => {
      const def = AVAILABLE_CHANNELS.find((d) => d.type === svc.type);
      const isExpanded = expandedService === svc.id;
      return /* @__PURE__ */ jsx(
        ServiceCard,
        {
          svc,
          def,
          companyId,
          isExpanded,
          onToggleExpand: () => setExpandedService(isExpanded ? null : svc.id),
          onRemove: () => handleRemoveService(svc.id)
        },
        svc.id
      );
    })
  ] }) });
}
function ServiceCard({ svc, def, companyId, isExpanded, onToggleExpand, onRemove }) {
  const { data: status, refresh } = usePluginData("connection-status", { serviceId: svc.id, companyId });
  const isConnected = status?.connected ?? false;
  const isLoading = status === void 0 || status === null;
  const pollRef = useRef(null);
  useEffect(() => {
    pollRef.current = setInterval(() => refresh(), 3e3);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);
  return /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
    /* @__PURE__ */ jsxs("div", { style: cardHeaderStyle, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "0.75rem" }, children: [
        !isLoading && /* @__PURE__ */ jsx("span", { style: dot(isConnected) }),
        /* @__PURE__ */ jsx("strong", { style: { fontSize: "14px" }, children: svc.name }),
        /* @__PURE__ */ jsx("span", { style: badgeStyle(def?.status !== "coming-soon" && isConnected), children: def?.status === "coming-soon" ? "Coming Soon" : isLoading ? "..." : isConnected ? "Connected" : "Not Connected" })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "0.5rem" }, children: [
        /* @__PURE__ */ jsx("button", { type: "button", style: btnSmall, onClick: onToggleExpand, children: isExpanded ? "Collapse" : isConnected ? "Edit" : "Setup" }),
        /* @__PURE__ */ jsx("button", { type: "button", style: btnSmallDanger, onClick: onRemove, children: "Remove" })
      ] })
    ] }),
    !isExpanded && /* @__PURE__ */ jsx("p", { style: { ...muted, margin: 0 }, children: def?.description ?? svc.type }),
    isExpanded && (def?.status === "coming-soon" ? /* @__PURE__ */ jsx(ComingSoonConfig, { serviceDef: def }) : svc.type === "zoho-cliq" ? /* @__PURE__ */ jsx(CliqConfig, { serviceId: svc.id, companyId }) : /* @__PURE__ */ jsx(ComingSoonConfig, { serviceDef: def ?? { type: svc.type, name: svc.name, description: "Unknown channel", status: "coming-soon", authType: "none" } }))
  ] });
}
export {
  AgentChannelsSettingsPage
};
//# sourceMappingURL=index.js.map
