import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useCallback, useEffect, useRef } from "react";
import { usePluginAction, usePluginData, } from "@paperclipai/plugin-sdk/ui";
import { CLIQ_SCOPES } from "../constants.js";
// ─── Styles ─────────────────────────────────────────────────────────────────
const btn = {
    appearance: "none", border: "1px solid var(--border)", borderRadius: "999px",
    background: "transparent", color: "inherit", padding: "6px 14px", fontSize: "12px", cursor: "pointer",
};
const btnPrimary = { ...btn, background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" };
const btnDanger = { ...btn, color: "var(--destructive, #dc2626)", borderColor: "var(--destructive, #dc2626)" };
const btnSmall = { ...btn, padding: "4px 10px", fontSize: "11px" };
const btnSmallDanger = { ...btnDanger, padding: "4px 10px", fontSize: "11px" };
const inputStyle = {
    flex: 1, border: "1px solid var(--border)", borderRadius: "8px",
    padding: "8px 10px", background: "transparent", color: "inherit", fontSize: "12px", minWidth: 0,
};
const selectStyle = { ...inputStyle, cursor: "pointer", minWidth: 160 };
const section = { marginBottom: "1.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "1.25rem" };
const row = { display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "center" };
const btnGroup = { display: "flex", gap: "0.5rem", marginTop: "0.75rem" };
const muted = { fontSize: "12px", color: "var(--muted-foreground, #888)" };
const dot = (ok) => ({
    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
    background: ok ? "var(--success, #22c55e)" : "var(--destructive, #dc2626)", marginRight: 6,
});
const cardStyle = {
    border: "1px solid var(--border)", borderRadius: "12px", padding: "1rem 1.25rem",
    marginBottom: "1rem", background: "var(--card, transparent)",
};
const cardHeaderStyle = {
    display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem",
};
const badgeStyle = (active) => ({
    fontSize: "10px", padding: "2px 8px", borderRadius: "999px",
    background: active ? "var(--success, #22c55e)" : "var(--muted, #666)",
    color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px",
});
const AVAILABLE_CHANNELS = [
    {
        type: "zoho-cliq", name: "Zoho Cliq",
        description: "Agent chat through Zoho Cliq bots",
        status: "available", authType: "oauth", provider: "zoho",
        // Single source of truth — kept in sync with the worker's CLIQ_SCOPES so
        // the consent URL always requests exactly what the bot uses (incl. the
        // org/users-read scopes for name resolution).
        scopes: CLIQ_SCOPES,
    },
    { type: "microsoft-teams", name: "Microsoft Teams", description: "Bot conversations in Teams", status: "coming-soon", authType: "oauth", provider: "microsoft" },
    { type: "discord", name: "Discord", description: "Bot commands in Discord servers", status: "coming-soon", authType: "oauth", provider: "discord" },
    { type: "slack", name: "Slack", description: "Bot conversations in Slack workspaces", status: "coming-soon", authType: "oauth", provider: "slack" },
];
function Autocomplete({ options, value, onChange, placeholder, disabled, }) {
    const [query, setQuery] = useState(value ? options.find((o) => o.id === value)?.label ?? "" : "");
    const [open, setOpen] = useState(false);
    const [focusIdx, setFocusIdx] = useState(-1);
    const wrapRef = useRef(null);
    const filtered = (query.length === 0
        ? options
        : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()) ||
            (o.sublabel?.toLowerCase().includes(query.toLowerCase()) ?? false))).filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i);
    useEffect(() => {
        const handler = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target))
                setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);
    useEffect(() => {
        if (value) {
            const match = options.find((o) => o.id === value);
            if (match && match.label !== query)
                setQuery(match.label);
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
            if (e.key === "ArrowDown" || e.key === "Enter")
                setOpen(true);
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
        }
        else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusIdx((i) => Math.max(i - 1, 0));
        }
        else if (e.key === "Enter" && focusIdx >= 0 && filtered[focusIdx]) {
            e.preventDefault();
            select(filtered[focusIdx]);
        }
        else if (e.key === "Escape") {
            setOpen(false);
        }
    };
    return (_jsxs("div", { ref: wrapRef, style: { position: "relative", flex: 1, minWidth: 0 }, children: [_jsx("input", { style: inputStyle, placeholder: placeholder, value: query, disabled: disabled, onChange: (e) => { setQuery(e.target.value); setOpen(true); setFocusIdx(-1); }, onFocus: () => setOpen(true), onKeyDown: handleKeyDown }), open && filtered.length > 0 && (_jsx("div", { style: {
                    position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                    maxHeight: 200, overflowY: "auto",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    background: "var(--popover, var(--background, #1a1a1a))",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.3)", marginTop: 2,
                }, children: filtered.map((opt, i) => (_jsxs("div", { style: {
                        padding: "6px 10px", cursor: "pointer", fontSize: "12px",
                        background: i === focusIdx ? "var(--accent, rgba(255,255,255,0.1))" : "transparent",
                    }, onMouseEnter: () => setFocusIdx(i), onMouseDown: (e) => { e.preventDefault(); select(opt); }, children: [opt.label, opt.sublabel && _jsx("span", { style: { ...muted, marginLeft: 6 }, children: opt.sublabel })] }, opt.id))) })), open && filtered.length === 0 && query.length > 0 && (_jsx("div", { style: {
                    position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                    padding: "8px 10px", fontSize: "12px",
                    border: "1px solid var(--border)", borderRadius: "8px",
                    background: "var(--popover, var(--background, #1a1a1a))",
                    color: "var(--muted-foreground, #888)", marginTop: 2,
                }, children: "No matches" }))] }));
}
// ─── OAuth Setup Component (reusable per service) ───────────────────────────
function OAuthSetup({ serviceId, serviceDef }) {
    const { data: status, refresh } = usePluginData("connection-status", { serviceId });
    const { data: connectData, refresh: refreshConnectUrl } = usePluginData("connect-url", { serviceId, scopes: serviceDef.scopes ?? "" });
    const saveOAuthConfig = usePluginAction("save-service-oauth-config");
    const disconnectAction = usePluginAction("disconnect-service");
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const [callbackUrl, setCallbackUrl] = useState("https://cortex.neoreef.com/oauth/callback");
    const [dataCenter, setDataCenter] = useState("US");
    const [configSaved, setConfigSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    // Poll while disconnected
    const pollRef = useRef(null);
    useEffect(() => {
        if (!status?.connected) {
            pollRef.current = setInterval(() => refresh(), 3000);
        }
        else if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        return () => { if (pollRef.current)
            clearInterval(pollRef.current); };
    }, [status?.connected, refresh]);
    const handleSaveConfig = useCallback(async () => {
        if (!clientId)
            return;
        setSaving(true);
        try {
            await saveOAuthConfig({ serviceId, clientId, clientSecret, callbackUrl, dataCenter });
            setConfigSaved(true);
            setTimeout(() => { refresh(); refreshConnectUrl(); }, 500);
        }
        catch (e) {
            console.error("Failed to save OAuth config:", e);
        }
        finally {
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
        return (_jsxs("div", { style: { ...section, paddingTop: "0.5rem" }, children: [_jsx("h4", { style: { marginTop: 0 }, children: "Connection" }), _jsxs("p", { style: { margin: "0.25rem 0" }, children: [_jsx("span", { style: dot(status.tokenValid) }), "Connected (", status.dataCenter, ")", " ", _jsxs("span", { style: muted, children: [status.tokenValid ? "Token valid" : "Token expired", status.tokenExpiresAt && ` — expires ${new Date(status.tokenExpiresAt).toLocaleString()}`] })] }), _jsxs("div", { style: btnGroup, children: [connectData?.configured && (_jsx("a", { href: connectData.connectUrl, target: "_blank", rel: "noopener", style: { textDecoration: "none" }, children: _jsx("button", { type: "button", style: btn, children: "Reconnect" }) })), _jsx("button", { type: "button", style: btnDanger, onClick: handleDisconnect, children: "Disconnect" })] })] }));
    }
    return (_jsxs("div", { style: { ...section, paddingTop: "0.5rem" }, children: [_jsx("h4", { style: { marginTop: 0 }, children: "Connection" }), _jsxs("p", { style: muted, children: ["Enter your ", serviceDef.provider === "zoho" ? "Zoho API Console" : serviceDef.name, " OAuth credentials."] }), _jsxs("div", { style: { display: "grid", gap: "0.5rem", marginTop: "0.75rem" }, children: [_jsxs("div", { style: row, children: [_jsx("label", { style: { width: 110, fontSize: "12px", flexShrink: 0 }, children: "Client ID" }), _jsx("input", { style: inputStyle, value: clientId, onChange: (e) => { setClientId(e.target.value); setConfigSaved(false); }, placeholder: "Client ID" })] }), _jsxs("div", { style: row, children: [_jsx("label", { style: { width: 110, fontSize: "12px", flexShrink: 0 }, children: "Client Secret" }), _jsx("input", { style: inputStyle, type: "password", value: clientSecret, onChange: (e) => { setClientSecret(e.target.value); setConfigSaved(false); }, placeholder: "Client secret" })] }), _jsxs("div", { style: row, children: [_jsx("label", { style: { width: 110, fontSize: "12px", flexShrink: 0 }, children: "Callback URL" }), _jsx("input", { style: inputStyle, value: callbackUrl, onChange: (e) => { setCallbackUrl(e.target.value); setConfigSaved(false); } })] }), serviceDef.provider === "zoho" && (_jsxs("div", { style: row, children: [_jsx("label", { style: { width: 110, fontSize: "12px", flexShrink: 0 }, children: "Data Center" }), _jsx("select", { style: { ...selectStyle, flex: 0, minWidth: 80 }, value: dataCenter, onChange: (e) => { setDataCenter(e.target.value); setConfigSaved(false); }, children: ["US", "EU", "IN", "AU", "JP", "CA"].map((dc) => _jsx("option", { value: dc, children: dc }, dc)) })] }))] }), _jsx("div", { style: btnGroup, children: !configSaved ? (_jsx("button", { type: "button", style: btnPrimary, onClick: handleSaveConfig, disabled: !clientId || saving, children: saving ? "Saving..." : "Save & Continue" })) : connectData?.configured ? (_jsx("a", { href: connectData.connectUrl, target: "_blank", rel: "noopener", style: { textDecoration: "none" }, children: _jsxs("button", { type: "button", style: btnPrimary, children: ["Connect to ", serviceDef.name] }) })) : (_jsx("button", { type: "button", style: btnPrimary, onClick: () => refresh(), children: "Loading connect URL... (click to retry)" })) })] }));
}
// ─── Cliq Config (bot mappings, shown after OAuth) ──────────────────────────
// ─── Deluge Script Templates ────────────────────────────────────────────────
const WEBHOOK_URL = "https://cortex.neoreef.com/cliq";
function delugeMessageHandler(botName) {
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
function delugeMentionHandler(botName) {
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
function delugeParticipationHandler(botName) {
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
function delugeButtonCallback() {
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
function ScriptBlock({ title, script, description }) {
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(script).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => { });
    }, [script]);
    return (_jsxs("div", { style: { marginBottom: "0.75rem" }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" }, children: [_jsxs("button", { type: "button", style: { ...btnSmall, fontFamily: "monospace" }, onClick: () => setExpanded(!expanded), children: [expanded ? "−" : "+", " ", title] }), _jsx("span", { style: muted, children: description })] }), expanded && (_jsxs("div", { style: { position: "relative", marginTop: "0.5rem" }, children: [_jsx("button", { type: "button", style: { ...btnSmall, position: "absolute", top: 6, right: 6, zIndex: 1, opacity: 0.8 }, onClick: handleCopy, children: copied ? "Copied" : "Copy" }), _jsx("pre", { style: {
                            background: "var(--code-bg, rgba(0,0,0,0.3))", borderRadius: "8px", padding: "0.75rem",
                            fontSize: "11px", lineHeight: "1.4", overflow: "auto", maxHeight: 300,
                            border: "1px solid var(--border)", margin: 0, whiteSpace: "pre", tabSize: 2,
                        }, children: script })] }))] }));
}
// ─── Inline Bot Setup Scripts (shown in the add-mapping form) ───────────────
function InlineBotSetup({ botName }) {
    return (_jsxs("div", { style: { marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }, children: [_jsxs("p", { style: { fontSize: "12px", margin: "0 0 0.5rem 0" }, children: [_jsx("strong", { children: "Bot Handlers" }), " \u2014 paste into your Cliq bot's handler config for ", _jsx("code", { children: botName }), ":"] }), _jsx(ScriptBlock, { title: "message_handler", description: "DM messages", script: delugeMessageHandler(botName) }), _jsx(ScriptBlock, { title: "mention_handler", description: "@mentions in channels", script: delugeMentionHandler(botName) }), _jsx(ScriptBlock, { title: "participation_handler", description: "Join/leave events", script: delugeParticipationHandler(botName) }), _jsxs("p", { style: { fontSize: "12px", margin: "0.75rem 0 0.5rem 0" }, children: [_jsx("strong", { children: "Button Callback" }), " \u2014 create in ", _jsx("em", { children: "Bots & Tools \u2192 Functions" }), " as ", _jsx("code", { children: "agentChannelsCallback" }), " (Button Function):"] }), _jsx(ScriptBlock, { title: "agentChannelsCallback", description: "Stop button, etc.", script: delugeButtonCallback() })] }));
}
// ─── Cliq Config (OAuth + bot mappings with inline setup) ───────────────────
function CliqConfig({ serviceId }) {
    const { data: status } = usePluginData("connection-status", { serviceId });
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
        if (botMappings && !dirty)
            setLocalMappings(botMappings);
    }, [botMappings, dirty]);
    const [selectedCompanyAgents, setSelectedCompanyAgents] = useState([]);
    const { data: agentsData } = usePluginData("paperclip-agents", newCompany ? { companyId: newCompany } : undefined);
    useEffect(() => {
        if (agentsData?.agents)
            setSelectedCompanyAgents(agentsData.agents);
    }, [agentsData]);
    const handleAddMapping = useCallback(async () => {
        if (!newBot || !newAgent || !newCompany)
            return;
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
        const updated = localMappings.map((m) => m.botUniqueName === botName ? { ...m, enabled: !m.enabled } : m);
        setLocalMappings(updated);
        setDirty(true);
        await saveMappingsAction({ mappings: updated });
        setDirty(false);
        refreshMappings();
    }, [localMappings, saveMappingsAction, refreshMappings]);
    const companies = companiesData?.companies ?? [];
    const agentOptions = selectedCompanyAgents.map((a) => ({ id: a.id, label: a.name }));
    return (_jsxs("div", { children: [_jsx(OAuthSetup, { serviceId: serviceId, serviceDef: serviceDef }), status?.connected && (_jsxs("div", { style: section, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }, children: [_jsx("h4", { style: { margin: 0 }, children: "Bot \u2192 Agent Mappings" }), !adding && (_jsx("button", { type: "button", style: btnSmall, onClick: () => setAdding(true), children: "+ Add" }))] }), _jsx("p", { style: muted, children: "Map each Cliq bot to a Paperclip agent. When a user DMs the bot, the message routes to that agent." }), localMappings.map((m) => (_jsxs("div", { style: { ...row, padding: "4px 0" }, children: [_jsx("span", { style: { flex: 1, fontSize: "13px", opacity: m.enabled ? 1 : 0.5 }, children: _jsx("strong", { children: m.botUniqueName }) }), _jsx("span", { style: muted, children: "\u2192" }), _jsxs("span", { style: { flex: 1, fontSize: "13px", opacity: m.enabled ? 1 : 0.5 }, children: [m.agentId.slice(0, 12), "..."] }), _jsx("button", { type: "button", style: btnSmall, onClick: () => handleToggle(m.botUniqueName), children: m.enabled ? "Disable" : "Enable" }), _jsx("button", { type: "button", style: btnSmallDanger, onClick: () => handleRemoveMapping(m.botUniqueName), children: "x" })] }, m.botUniqueName))), adding && (_jsxs("div", { style: { ...cardStyle, padding: "0.75rem 1rem" }, children: [_jsx("div", { style: { ...row, marginBottom: "0.5rem" }, children: _jsx("input", { style: inputStyle, value: newBot, onChange: (e) => setNewBot(e.target.value), placeholder: "Bot unique name (e.g. jarvis_bot)" }) }), _jsxs("div", { style: row, children: [_jsxs("select", { style: selectStyle, value: newCompany, onChange: (e) => { setNewCompany(e.target.value); setNewAgent(""); }, children: [_jsx("option", { value: "", children: "Select company..." }), companies.map((c) => (_jsx("option", { value: c.id, children: c.name }, c.id)))] }), _jsx("span", { style: muted, children: "\u2192" }), _jsx(Autocomplete, { options: agentOptions, value: newAgent, onChange: (id) => setNewAgent(id), placeholder: "Search agent...", disabled: !newCompany })] }), newBot && _jsx(InlineBotSetup, { botName: newBot }), _jsxs("div", { style: btnGroup, children: [_jsx("button", { type: "button", style: btnPrimary, onClick: handleAddMapping, disabled: !newBot || !newAgent || !newCompany, children: "Save" }), _jsx("button", { type: "button", style: btn, onClick: () => { setAdding(false); setNewBot(""); setNewAgent(""); setNewCompany(""); }, children: "Cancel" })] })] })), localMappings.length === 0 && !adding && (_jsx("p", { style: muted, children: "No bots mapped yet. Click + Add to map a Cliq bot to a Paperclip agent." }))] })), status?.connected && _jsx(ServiceNotifySection, { serviceId: serviceId, companies: companies })] }));
}
// ─── Coming Soon ────────────────────────────────────────────────────────────
function ComingSoonConfig({ serviceDef }) {
    return (_jsx("div", { style: { padding: "1rem 0" }, children: _jsxs("p", { style: muted, children: [serviceDef.description, " \u2014 coming soon."] }) }));
}
/**
 * "Paperclip → User Notifications" for one channel service. Opt-in toggle plus a
 * table mapping a Paperclip user to this channel's user. Lives inside the
 * service config so each platform owns its own identity mapping (AC-6).
 */
function ServiceNotifySection({ serviceId, companies }) {
    const { data: notify, refresh } = usePluginData("service-notify", { serviceId });
    const { data: cliqUsersData } = usePluginData("cliq-users");
    const save = usePluginAction("save-service-notify");
    const [companyId, setCompanyId] = useState("");
    const { data: pcUsersData } = usePluginData("paperclip-users", companyId ? { companyId } : undefined);
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
        return u ? `${u.membershipRole ?? "member"} · ${id.slice(0, 8)}…` : `${id.slice(0, 12)}…`;
    };
    const pcOptions = pcUsers.map((u) => ({
        id: u.principalId,
        label: `${u.membershipRole ?? "member"} · ${u.principalId.slice(0, 10)}…`,
        sublabel: u.principalId,
    }));
    const cliqOptions = cliqUsers.map((u) => ({
        id: u.id, label: u.name, sublabel: u.email,
    }));
    async function persist(nextEnabled, nextMappings) {
        await save({ serviceId, config: { enabled: nextEnabled, mappings: nextMappings } });
        refresh();
    }
    async function toggle() { const v = !enabled; setEnabled(v); await persist(v, mappings); }
    function resetForm() {
        setAdding(false);
        setNewPc("");
        setNewPcLabel("");
        setNewCliq("");
        setNewCliqLabel("");
    }
    async function addMapping() {
        if (!newPc || !newCliq)
            return;
        const next = [
            ...mappings.filter((m) => m.paperclipUserId !== newPc),
            { paperclipUserId: newPc, channelUserId: newCliq, label: newCliqLabel || cliqLabelFor(newCliq), enabled: true },
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
    return (_jsxs("div", { style: section, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }, children: [_jsx("h4", { style: { margin: 0 }, children: "Paperclip \u2192 User Notifications" }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [enabled && !adding && (_jsx("button", { type: "button", style: btnSmall, onClick: () => setAdding(true), children: "+ Add" })), _jsxs("label", { style: { ...muted, display: "flex", alignItems: "center", gap: 4 }, children: [_jsx("input", { type: "checkbox", checked: enabled, onChange: toggle }), " enabled"] })] })] }), _jsx("p", { style: muted, children: "When on, Paperclip events (approvals, blocked items) are sent to the mapped Cliq user." }), enabled && (_jsxs(_Fragment, { children: [mappings.map((m) => (_jsxs("div", { style: { ...row, padding: "4px 0" }, children: [_jsx("span", { style: { flex: 1, fontSize: 13 }, title: m.paperclipUserId, children: pcLabelFor(m.paperclipUserId) }), _jsx("span", { style: muted, children: "\u2192" }), _jsx("span", { style: { flex: 1, fontSize: 13 }, children: m.label ?? cliqLabelFor(m.channelUserId) }), _jsx("button", { type: "button", style: btnSmallDanger, onClick: () => removeMapping(m.paperclipUserId), children: "x" })] }, m.paperclipUserId))), mappings.length === 0 && !adding && (_jsx("p", { style: muted, children: "No users mapped yet. Click + Add to notify a Paperclip user on Cliq." })), adding && (_jsxs("div", { style: { ...cardStyle, padding: "0.75rem 1rem" }, children: [_jsxs("div", { style: { ...row, marginBottom: "0.5rem", flexWrap: "wrap" }, children: [_jsxs("select", { style: selectStyle, value: companyId, onChange: (e) => { setCompanyId(e.target.value); setNewPc(""); setNewPcLabel(""); }, children: [_jsx("option", { value: "", children: "Select company\u2026" }), companies.map((c) => _jsx("option", { value: c.id, children: c.name }, c.id))] }), _jsx("div", { style: { minWidth: 200 }, children: _jsx(Autocomplete, { options: pcOptions, value: newPc, onChange: (id, label) => { setNewPc(id); setNewPcLabel(label); }, placeholder: companyId ? "Paperclip user…" : "Select company first", disabled: !companyId }) }), _jsx("span", { style: muted, children: "\u2192" }), cliqOptions.length > 0 ? (_jsx("div", { style: { minWidth: 200 }, children: _jsx(Autocomplete, { options: cliqOptions, value: newCliq, onChange: (id, label) => { setNewCliq(id); setNewCliqLabel(label); }, placeholder: "Search Cliq user\u2026" }) })) : (_jsx("input", { style: { ...inputStyle, minWidth: 180 }, value: newCliq, onChange: (e) => { setNewCliq(e.target.value); setNewCliqLabel(""); }, placeholder: "Cliq user id" }))] }), _jsxs("div", { style: btnGroup, children: [_jsx("button", { type: "button", style: btnPrimary, onClick: addMapping, disabled: !newPc || !newCliq, children: "Save" }), _jsx("button", { type: "button", style: btn, onClick: resetForm, children: "Cancel" })] }), cliqOptions.length === 0 && (_jsx("p", { style: { ...muted, marginTop: 6, marginBottom: 0 }, children: "Cliq user lookup unavailable (needs the users-read scope) \u2014 enter the Cliq user id directly." }))] }))] }))] }));
}
// ─── Main Settings Page ─────────────────────────────────────────────────────
export function AgentChannelsSettingsPage(_props) {
    const { data: services, refresh: refreshServices } = usePluginData("services");
    const addService = usePluginAction("add-service");
    const removeService = usePluginAction("remove-service");
    const [addingService, setAddingService] = useState(false);
    const [selectedType, setSelectedType] = useState("");
    const [expandedService, setExpandedService] = useState(null);
    // Per-service connection status for badges
    const serviceList = services ?? [];
    const [serviceStatuses, setServiceStatuses] = useState({});
    // Poll connection status for all services
    useEffect(() => {
        if (serviceList.length === 0)
            return;
        const poll = async () => {
            // We can't call usePluginData per service in a loop, so we rely on
            // the individual CliqConfig components to show status. The badge
            // uses a simplified check.
        };
        poll();
    }, [serviceList]);
    const handleAddService = useCallback(async () => {
        if (!selectedType)
            return;
        const def = AVAILABLE_CHANNELS.find((s) => s.type === selectedType);
        if (!def)
            return;
        await addService({ serviceType: def.type, name: def.name });
        setAddingService(false);
        setSelectedType("");
        refreshServices();
    }, [selectedType, addService, refreshServices]);
    const handleRemoveService = useCallback(async (serviceId) => {
        if (!confirm("Remove this channel and its configuration?"))
            return;
        await removeService({ serviceId });
        refreshServices();
    }, [removeService, refreshServices]);
    const configuredTypes = new Set(serviceList.map((s) => s.type));
    return (_jsx("div", { style: { padding: "1.5rem", maxWidth: 850 }, children: _jsxs("div", { style: section, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }, children: [_jsx("h3", { style: { margin: 0 }, children: "Messaging Channels" }), !addingService && (_jsx("button", { type: "button", style: btnSmall, onClick: () => setAddingService(true), children: "+ Add Channel" }))] }), addingService && (_jsxs("div", { style: { ...cardStyle, borderColor: "var(--border)" }, children: [_jsxs("div", { style: row, children: [_jsxs("select", { style: { ...selectStyle, minWidth: 220 }, value: selectedType, onChange: (e) => setSelectedType(e.target.value), children: [_jsx("option", { value: "", children: "Select a channel..." }), AVAILABLE_CHANNELS.map((s) => (_jsxs("option", { value: s.type, disabled: configuredTypes.has(s.type), children: [s.name, configuredTypes.has(s.type) ? " (already added)" : "", s.status === "coming-soon" ? " (coming soon)" : ""] }, s.type)))] }), _jsx("button", { type: "button", style: btnPrimary, onClick: handleAddService, disabled: !selectedType, children: "Add" }), _jsx("button", { type: "button", style: btn, onClick: () => { setAddingService(false); setSelectedType(""); }, children: "Cancel" })] }), selectedType && (_jsx("p", { style: { ...muted, marginTop: "0.5rem", marginBottom: 0 }, children: AVAILABLE_CHANNELS.find((s) => s.type === selectedType)?.description }))] })), serviceList.length === 0 && !addingService && (_jsx("p", { style: muted, children: "No channels connected yet. Add a channel to start routing agent conversations." })), serviceList.map((svc) => {
                    const def = AVAILABLE_CHANNELS.find((d) => d.type === svc.type);
                    const isExpanded = expandedService === svc.id;
                    return (_jsx(ServiceCard, { svc: svc, def: def, isExpanded: isExpanded, onToggleExpand: () => setExpandedService(isExpanded ? null : svc.id), onRemove: () => handleRemoveService(svc.id) }, svc.id));
                })] }) }));
}
// ─── Service Card with inline connection status ─────────────────────────────
function ServiceCard({ svc, def, isExpanded, onToggleExpand, onRemove }) {
    const { data: status, refresh } = usePluginData("connection-status", { serviceId: svc.id });
    const isConnected = status?.connected ?? false;
    const isLoading = status === undefined || status === null;
    // Poll connection status so badge stays in sync
    const pollRef = useRef(null);
    useEffect(() => {
        pollRef.current = setInterval(() => refresh(), 3000);
        return () => { if (pollRef.current)
            clearInterval(pollRef.current); };
    }, [refresh]);
    return (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: cardHeaderStyle, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: "0.75rem" }, children: [!isLoading && _jsx("span", { style: dot(isConnected) }), _jsx("strong", { style: { fontSize: "14px" }, children: svc.name }), _jsx("span", { style: badgeStyle(def?.status !== "coming-soon" && isConnected), children: def?.status === "coming-soon" ? "Coming Soon" : isLoading ? "..." : isConnected ? "Connected" : "Not Connected" })] }), _jsxs("div", { style: { display: "flex", gap: "0.5rem" }, children: [_jsx("button", { type: "button", style: btnSmall, onClick: onToggleExpand, children: isExpanded ? "Collapse" : isConnected ? "Edit" : "Setup" }), _jsx("button", { type: "button", style: btnSmallDanger, onClick: onRemove, children: "Remove" })] })] }), !isExpanded && (_jsx("p", { style: { ...muted, margin: 0 }, children: def?.description ?? svc.type })), isExpanded && (def?.status === "coming-soon"
                ? _jsx(ComingSoonConfig, { serviceDef: def })
                : svc.type === "zoho-cliq"
                    ? _jsx(CliqConfig, { serviceId: svc.id })
                    : _jsx(ComingSoonConfig, { serviceDef: def ?? { type: svc.type, name: svc.name, description: "Unknown channel", status: "coming-soon", authType: "none" } }))] }));
}
//# sourceMappingURL=index.js.map