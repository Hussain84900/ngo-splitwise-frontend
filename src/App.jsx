import React, { useEffect, useMemo, useState } from "react";
import emailjs from "@emailjs/browser";
import "./App.css";

/**
 * Donation Pool Split (Pledges) - React Frontend (CRA)
 */

const COUNTRY_AGG_BASE =
  "http://country-aggregator-api-env.eba-6iq87h7d.us-east-1.elasticbeanstalk.com";

const SPLIT_API_URL = "https://d2isu9kxsrozg8.cloudfront.net/split/weighted";

// ----------------------------- Helpers -----------------------------
async function httpJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : data?.detail || data?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function moneyFmt(amount, currencyCode) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(Number(amount) || 0);
  } catch {
    return `${currencyCode} ${Number(amount || 0).toFixed(2)}`;
  }
}

function buildCountrySummaryUrl(countryName) {
  const name = (countryName || "").trim();
  const encoded = encodeURIComponent(name);
  return `${COUNTRY_AGG_BASE}/countries/${encoded}/summary`;
}

function normalizeCountrySummary(raw, fallbackCountryName) {
  const safe = raw && typeof raw === "object" ? raw : {};

  const rawCurrency =
    safe.currency ?? safe.currencyCode ?? safe.currency_code ?? "USD";
  const currency =
    typeof rawCurrency === "string"
      ? { code: rawCurrency, name: rawCurrency, symbol: "" }
      : {
          code: rawCurrency?.code || "USD",
          name: rawCurrency?.name || rawCurrency?.code || "USD",
          symbol: rawCurrency?.symbol || "",
        };

  const city =
    safe.city ??
    safe.capitalCity ??
    safe.capital ??
    safe.capital_name ??
    safe?.summary?.city ??
    safe?.summary?.capital ??
    "";

  return {
    countryName:
      safe.countryName ?? safe.name ?? safe.country ?? fallbackCountryName ?? "Unknown",
    countryCode: safe.countryCode ?? safe.code ?? safe.iso2 ?? safe.iso ?? "--",
    currency,
    city,
    timezone: safe.timezone ?? safe.timeZone ?? safe.tz ?? "Unknown",
    callingCode:
      safe.callingCode ?? safe.calling_code ?? safe.dialCode ?? safe.dial_code ?? "",
    raw,
  };
}

// ----------------------------- API functions -----------------------------
async function apiGetCountrySummary(countryName) {
  const url = buildCountrySummaryUrl(countryName);
  const data = await httpJson(url, { method: "GET" });
  return normalizeCountrySummary(data, countryName);
}

async function apiSplitWeighted({ total_amount, participants }) {
  return await httpJson(SPLIT_API_URL, {
    method: "POST",
    body: JSON.stringify({ total_amount, participants }),
  });
}

function parsePositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ----------------------------- UI -----------------------------
export default function App() {
  const [campaignTitle, setCampaignTitle] = useState("");
  const [countryName, setCountryName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");

  const [countryLoading, setCountryLoading] = useState(false);
  const [countryError, setCountryError] = useState("");
  const [countryInfo, setCountryInfo] = useState(() =>
    normalizeCountrySummary(null, "Ireland")
  );

  const [campaigns, setCampaigns] = useState([]);

  const [members, setMembers] = useState([
    { id: "m1", name: "Hussain", pledge: "6" },
    { id: "m2", name: "shaan", pledge: "4" },
  ]);

  const [splitLoading, setSplitLoading] = useState(false);
  const [splitError, setSplitError] = useState("");
  const [splitResult, setSplitResult] = useState(null);

  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailStatus, setEmailStatus] = useState("");

  const parsedTarget = useMemo(
    () => parsePositiveNumber(targetAmount),
    [targetAmount]
  );
  const currencyCode = countryInfo.currency.code;

  useEffect(() => {
    const name = countryName.trim();
    if (!name) {
      setCountryError("Enter a country name.");
      setCountryInfo(normalizeCountrySummary(null, ""));
      return;
    }

    const t = setTimeout(async () => {
      try {
        setCountryLoading(true);
        setCountryError("");
        const info = await apiGetCountrySummary(name);
        setCountryInfo(info);
      } catch (e) {
        setCountryError(e.message);
        setCountryInfo(normalizeCountrySummary(null, name));
      } finally {
        setCountryLoading(false);
      }
    }, 400);

    return () => clearTimeout(t);
  }, [countryName]);

  function setMember(idx, patch) {
    setMembers((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, ...patch } : m))
    );
    setSplitResult(null);
  }

  function addMember() {
    setMembers((prev) => [
      ...prev,
      { id: `m_${Date.now()}`, name: `Member ${prev.length + 1}`, pledge: "1" },
    ]);
    setSplitResult(null);
  }

  function removeMember(idx) {
    setMembers((prev) => prev.filter((_, i) => i !== idx));
    setSplitResult(null);
  }

  function handleAddCampaign() {
    const title = campaignTitle.trim();
    const cName = countryName.trim();

    if (!title) return alert("Campaign name is required.");
    if (!cName) return alert("Country is required.");
    if (parsedTarget <= 0) return alert("Amount must be > 0.");

    const city = countryInfo.city || "-";

    const newCampaign = {
      id: `camp_${Date.now()}`,
      name: title,
      country: countryInfo.countryName || cName,
      city,
      amount: parsedTarget,
      currency: currencyCode || "USD",
    };

    setCampaigns((prev) => [newCampaign, ...prev]);
  }

  async function handleSplit() {
    setSplitError("");
    setSplitResult(null);

    if (parsedTarget <= 0) {
      setSplitError("Amount must be > 0.");
      return;
    }

    const participants = members
      .map((m) => ({
        name: (m.name || "").trim(),
        weight: parsePositiveNumber(m.pledge),
      }))
      .filter((p) => p.name && p.weight > 0);

    if (participants.length === 0) {
      setSplitError("Add at least one member with a valid pledge/weight > 0.");
      return;
    }

    try {
      setSplitLoading(true);
      const data = await apiSplitWeighted({
        total_amount: parsedTarget,
        participants,
      });
      setSplitResult(data);
    } catch (e) {
      setSplitError(e.message);
    } finally {
      setSplitLoading(false);
    }
  }

  async function sendCampaignSummaryEmail(campaign) {
    setEmailError("");
    setEmailStatus("");

    const to = recipientEmail.trim();
    if (!to) {
      setEmailError("Enter recipient email.");
      return;
    }
    if (!campaign) {
      setEmailError("No campaign selected/available.");
      return;
    }

    const serviceId = process.env.REACT_APP_EMAILJS_SERVICE_ID;
    const templateId = process.env.REACT_APP_EMAILJS_TEMPLATE_ID;
    const publicKey = process.env.REACT_APP_EMAILJS_PUBLIC_KEY;

    if (!serviceId || !templateId || !publicKey) {
      setEmailError("EmailJS env vars missing. Check your .env file.");
      return;
    }

    const splitLines =
      (splitResult?.participants || [])
        .map((p) => {
          const shareText =
            p.share == null
              ? "-"
              : moneyFmt(p.share, campaign.currency || currencyCode);
          return `${p.name} | weight=${p.weight} | share=${shareText}`;
        })
        .join("\n") ||
      "No split calculated yet. Click 'Calculate split (API)' first.";

    const pledgeLines = members
      .map((m) => `${m.name} | weight=${m.pledge}`)
      .join("\n");

    const templateParams = {
      to_email: to,
      generated_at: new Date().toLocaleString(),
      campaign_name: campaign.name,
      country:
        campaign.country || countryInfo.countryName || countryName.trim(),
      city: campaign.city,
      amount: String(campaign.amount),
      currency: campaign.currency,
      split_lines: splitLines,
      pledge_lines: pledgeLines,
    };

    try {
      setEmailSending(true);
      await emailjs.send(serviceId, templateId, templateParams, publicKey);
      setEmailStatus("Email sent successfully via EmailJS.");
    } catch (e) {
      setEmailError(e?.text || e?.message || "Failed to send email.");
    } finally {
      setEmailSending(false);
    }
  }

  const campaignToEmail = campaigns[0] || null;

  const shareByName = useMemo(() => {
    const map = new Map();
    const list = splitResult?.participants || [];
    for (const p of list) map.set(p.name, p.share);
    return map;
  }, [splitResult]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      <h1>Donation Pool Split (Pledges)</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
        {/* Campaign form */}
        <section style={card}>
          <h2>Add Campaign</h2>

          <div style={row}>
            <label style={label}>Campaign name</label>
            <input
              style={input}
              value={campaignTitle}
              onChange={(e) => setCampaignTitle(e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={row}>
              <label style={label}>Country</label>
              <input
                style={input}
                value={countryName}
                onChange={(e) => setCountryName(e.target.value)}
                placeholder='e.g. "Ireland"'
              />
              {/*<div style={muted}>
                Country API:{" "}
                <code>
                  {COUNTRY_AGG_BASE}/countries/{"{country_name}"}/summary
                </code>
              </div>*/}
              {countryLoading ? (
                <div style={muted}>Loading country details...</div>
              ) : null}
              {countryError ? (
                <div style={errorSmall}>{countryError}</div>
              ) : null}
            </div>

            <div style={row}>
              <label style={label}>Amount ({currencyCode})</label>
              <input
                style={input}
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder="10000"
              />
            </div>
          </div>

          <div style={{ marginTop: 8, fontSize: 13, color: "#444" }}>
            <div>
              <b>Detected country:</b> {countryInfo.countryName || "-"}
            </div>
            <div>
              <b>City:</b> {countryInfo.city || "-"}
            </div>
            <div>
              <b>Currency:</b> {countryInfo.currency.code} -{" "}
              {countryInfo.currency.name}
            </div>
          </div>

          <div
            style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}
          >
            <button style={btnPrimary} onClick={handleAddCampaign}>
              Add to Campaigns
            </button>
            <button
              style={btnSecondary}
              onClick={handleSplit}
              disabled={splitLoading}
            >
              {splitLoading ? "Calculating..." : "Calculate split (API)"}
            </button>
          </div>

          {splitError ? <p style={error}>{splitError}</p> : null}
        </section>

        {/* Campaigns list + Email */}
        <section style={card}>
          <h2>Campaigns</h2>

          {campaigns.length === 0 ? (
            <p style={muted}>No campaigns yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {campaigns.map((c) => (
                <div key={c.id} style={campaignItem}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{c.name}</div>
                    <div style={{ fontWeight: 800 }}>
                      {moneyFmt(c.amount, c.currency)}
                    </div>
                  </div>
                  <div style={mutedSmall}>
                    Country: <b>{c.country || "-"}</b> &nbsp;|&nbsp; City:{" "}
                    <b>{c.city}</b>
                  </div>
                </div>
              ))}
            </div>
          )}

          <hr style={{ margin: "16px 0" }} />
          <h3>Email (EmailJS)</h3>

          <input
            style={input}
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="Recipient email (e.g. member@gmail.com)"
          />

          <button
            style={{ ...btnPrimary, marginTop: 10 }}
            onClick={() => sendCampaignSummaryEmail(campaignToEmail)}
            disabled={emailSending || !campaignToEmail}
          >
            {emailSending ? "Sending..." : "Send Campaign Email"}
          </button>

          {emailError ? (
            <div style={{ color: "#b91c1c", fontSize: 13 }}>{emailError}</div>
          ) : null}
          {emailStatus ? (
            <div style={{ color: "#166534", fontSize: 13 }}>{emailStatus}</div>
          ) : null}
        </section>
      </div>

      {/* Members */}
      <section style={{ ...card, marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>Members (Pledges to Weights)</h2>
          <button style={btnSecondary} onClick={addMember}>
            + Add member
          </button>
        </div>

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Pledge / Weight</th>
                <th style={th}>Share</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, idx) => {
                const share = shareByName.get(m.name) ?? null;
                return (
                  <tr key={m.id}>
                    <td style={td}>
                      <input
                        style={cellInput}
                        value={m.name}
                        onChange={(e) =>
                          setMember(idx, { name: e.target.value })
                        }
                        placeholder="Name"
                      />
                    </td>

                    <td style={td}>
                      <input
                        style={cellInput}
                        value={m.pledge}
                        onChange={(e) =>
                          setMember(idx, { pledge: e.target.value })
                        }
                        placeholder="Weight"
                      />
                    </td>

                    <td style={td}>
                      {share === null ? (
                        <span style={mutedSmall}>-</span>
                      ) : (
                        moneyFmt(share, currencyCode)
                      )}
                    </td>

                    <td style={td}>
                      <button
                        style={btnDangerSmall}
                        onClick={() => removeMember(idx)}
                        disabled={members.length <= 1}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ----------------------------- Styles -----------------------------
const card = {
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
};

const row = { display: "grid", gap: 6, marginBottom: 12 };
const label = { fontSize: 13, color: "#333" };

const input = {
  border: "1px solid #ccc",
  borderRadius: 10,
  padding: "10px 12px",
  outline: "none",
  width: "100%",
};

const btnPrimary = {
  border: "none",
  background: "#111827",
  color: "white",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer",
};

const btnSecondary = {
  border: "1px solid #ccc",
  background: "white",
  color: "#111827",
  padding: "10px 14px",
  borderRadius: 10,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnDangerSmall = {
  border: "1px solid #fecaca",
  background: "#fee2e2",
  color: "#7f1d1d",
  padding: "8px 10px",
  borderRadius: 10,
  cursor: "pointer",
};

const table = { width: "100%", borderCollapse: "collapse", marginTop: 8 };

const th = {
  textAlign: "left",
  borderBottom: "1px solid #eee",
  padding: "10px 8px",
  fontSize: 13,
  color: "#333",
  whiteSpace: "nowrap",
};

const td = {
  borderBottom: "1px solid #f2f2f2",
  padding: "10px 8px",
  fontSize: 14,
  verticalAlign: "top",
};

const cellInput = {
  border: "1px solid #ddd",
  borderRadius: 10,
  padding: "8px 10px",
  outline: "none",
  width: "100%",
};

const muted = { color: "#666", fontSize: 13, marginTop: 10 };
const mutedSmall = { color: "#666", fontSize: 12 };

const error = { color: "#b91c1c", fontSize: 13, marginTop: 10 };
const errorSmall = { color: "#b91c1c", fontSize: 12, marginTop: 6 };

const campaignItem = {
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
  background: "#fafafa",
};
