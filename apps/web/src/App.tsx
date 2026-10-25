import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  Activity, ArrowDownLeft, ArrowRight, Bell, Check, CheckCircle2, ChevronDown, Clock3,
  Compass, ContactRound, History, LifeBuoy, LogOut, MapPin, Menu, Navigation, Plus,
  Radio, Route as RouteIcon, Shield, ShieldCheck, Siren, SlidersHorizontal, Sparkles,
  Trash2, UserRound, Users, X,
} from "lucide-react";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import ExistingSafetyPlatform from "./ExistingSafetyPlatform";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
type User = { id: string; name: string; email: string; timezone?: string; locationConsent?: boolean };
type Contact = { id: string; name: string; email: string; phone?: string | null };
type Journey = {
  id: string; origin: string; destination: string; mode: string; vehicleDetails?: string | null;
  status: string; expectedArrival: string; nextCheckInAt: string; startedAt: string;
  endedAt?: string | null; checkInMinutes: number; graceMinutes: number; locationSharing: boolean;
  demo: boolean; locations: { latitude: number; longitude: number; recordedAt: string }[];
  checkIns: { id: string; kind: string; message?: string | null; createdAt: string }[];
  events: { id: string; type: string; details?: string | null; createdAt: string; simulated: boolean }[];
  notifications: { id: string; kind: string; status: string; recipient: string }[];
  trustedContacts?: { trustedContact: { id: string; name: string; email: string } }[];
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Something went wrong.");
  return body as T;
}

function Brand({ small = false }: { small?: boolean }) {
  return <Link to="/" className={`brand ${small ? "brand-small" : ""}`}><span className="brand-mark"><ShieldCheck size={21} strokeWidth={2.4} /></span><span>safe<span>stride</span></span></Link>;
}

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const result = await api<{ user: User }>(path, { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      onLogin(result.user);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page">
    <section className="auth-intro">
      <Brand />
      <div className="auth-copy"><span className="eyebrow"><Sparkles size={14} /> YOUR JOURNEY, WITH A SAFER STRIDE</span>
        <h1>A little more<br />peace of mind.</h1>
        <p>Let someone you trust know you’re on your way. We’ll help keep the check-ins going.</p>
        <div className="trust-note"><Shield size={18} /><span>Your location is only shared when you choose to share it.</span></div>
      </div>
      <div className="auth-foot">Thoughtfully made for the journey ahead.</div>
    </section>
    <section className="auth-form-wrap">
      <div className="auth-form">
        <div className="mobile-brand"><Brand /></div>
        <span className="eyebrow">WELCOME {mode === "login" ? "BACK" : "ABOARD"}</span>
        <h2>{mode === "login" ? "Sign in to SafeStride" : "Create your account"}</h2>
        <p className="muted">Your safer journey starts with one small step.</p>
        <form onSubmit={submit} className="form-stack">
          {mode === "register" && <label>Your name<input name="name" placeholder="e.g. Alex Morgan" autoComplete="name" required maxLength={80} /></label>}
          <label>Email address<input name="email" type="email" placeholder="you@example.com" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" placeholder={mode === "register" ? "At least 10 characters" : "Your password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 10 : 1} maxLength={128} /></label>
          {error && <div className="error-box" role="alert">{error}</div>}
          <button className="button button-primary button-wide" disabled={busy}>{busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"} <ArrowRight size={17} /></button>
        </form>
        <p className="switch-auth">{mode === "login" ? "New to SafeStride?" : "Already have an account?"} <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></p>
        <div className="demo-login"><Sparkles size={16} /><div><b>Just exploring?</b><span>Try demo@safestride.example · SafeStrideDemo2026!</span></div></div>
      </div>
    </section>
  </main>;
}

function FitBounds({ point }: { point: LatLngExpression }) {
  const map = useMap();
  useEffect(() => { map.setView(point, 14); }, [map, point]);
  return null;
}

function JourneyMap({ journey }: { journey: Journey }) {
  const location = journey.locations[0];
  if (!location) return <div className="map-placeholder"><MapPin size={22} /><b>No location shared yet</b><span>When location sharing is enabled, your last reported position appears here.</span></div>;
  const point: LatLngExpression = [location.latitude, location.longitude];
  return <div className="map-frame"><MapContainer center={point} zoom={14} scrollWheelZoom={false} className="leaflet-map">
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <FitBounds point={point} /><CircleMarker center={point} radius={9} pathOptions={{ color: "#20c7ae", fillColor: "#20c7ae", fillOpacity: 0.8 }} />
  </MapContainer><span className="map-caption"><Radio size={12} /> Last reported · {new Date(location.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [active, setActive] = useState<Journey | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [history, setHistory] = useState<Journey[]>([]);
  const [page, setPage] = useState("safety-platform");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    try {
      const [activeResult, historyResult, contactResult] = await Promise.all([
        api<{ journey: Journey | null }>("/journeys/active"),
        api<{ journeys: Journey[] }>("/journeys"),
        api<{ contacts: Contact[] }>("/contacts"),
      ]);
      setActive(activeResult.journey);
      setHistory(historyResult.journeys);
      setContacts(contactResult.contacts);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load your journeys."); }
  }, []);
  useEffect(() => {
    api<{ user: User }>("/auth/me").then((result) => { setUser(result.user); return refresh(); })
      .catch(() => setUser(null)).finally(() => setAuthReady(true));
  }, [refresh]);
  useEffect(() => {
    if (!user || !active?.locationSharing || !navigator.geolocation) return;
    let lastSentAt = 0;
    const watchId = navigator.geolocation.watchPosition(({ coords }) => {
      if (Date.now() - lastSentAt < 30000) return;
      lastSentAt = Date.now();
      void api<{ location: Journey["locations"][number] }>(`/journeys/${active.id}/location`, {
        method: "POST",
        body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }),
      }).then(({ location }) => setActive((current) => current?.id === active.id ? { ...current, locations: [location] } : current))
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Location update failed."));
    }, () => setError("Location permission was unavailable. Check-ins continue to work without location."), {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 12000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [active?.id, active?.locationSharing, user]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); } }, [notice]);
  async function runAction(path: string, method = "POST", body?: unknown, message = "Updated.") {
    setError(""); setBusy(true);
    try { await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); await refresh(); setNotice(message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed."); }
    finally { setBusy(false); }
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null); setActive(null); setHistory([]); navigate("/");
  }

  if (!authReady) return <div className="loading-screen"><div className="spinner" />Preparing your safe space…</div>;
  const nav = [
    { key: "safety-platform", text: "Journey safety", icon: Navigation },
    { key: "overview", text: "Overview", icon: Compass },
    { key: "journeys", text: "My journeys", icon: History },
    { key: "contacts", text: "Trusted people", icon: Users },
    { key: "settings", text: "Settings", icon: SlidersHorizontal },
  ];
  if (!user) return <Routes><Route path="/share/:token" element={<PublicShare />} /><Route path="*" element={<AuthScreen onLogin={(value) => { setUser(value); void refresh(); }} />} /></Routes>;

  async function startJourney(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const contactIds = form.getAll("contactIds").map(String);
    try {
      await api("/journeys", { method: "POST", body: JSON.stringify({
        origin: form.get("origin"), destination: form.get("destination"), mode: form.get("mode"),
        vehicleDetails: form.get("vehicleDetails") || undefined,
        expectedArrival: new Date(Date.now() + Number(form.get("duration")) * 60000).toISOString(),
        checkInMinutes: Number(form.get("checkInMinutes")), graceMinutes: Number(form.get("graceMinutes")),
        contactIds, locationSharing: form.get("locationSharing") === "on", demo: form.get("demo") === "on",
      }) });
      await refresh(); setPage("overview"); setNotice("Your protected journey has started. Take care out there.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start your journey."); }
    finally { setBusy(false); }
  }
  async function captureLocation() {
    if (!active || !navigator.geolocation) { setError("Location is unavailable in this browser."); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => { void runAction(`/journeys/${active.id}/location`, "POST", { latitude: position.coords.latitude, longitude: position.coords.longitude }, "Location shared securely."); },
      () => setError("Location permission was unavailable. You can still check in without it."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  async function shareJourney() {
    if (!active) return;
    try {
      const result = await api<{ shareUrl: string }>(`/journeys/${active.id}/share`, { method: "POST" });
      await navigator.clipboard.writeText(result.shareUrl);
      setNotice("Private share link copied. It expires in 4 hours.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create a share link."); }
  }
  const selectedNav = nav.find((item) => item.key === page);
  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
      <div className="sidebar-top"><Brand small /><button className="icon-button close-menu" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="workspace-label">YOUR SPACE</div>
      <nav className="side-nav">{nav.map(({ key, text, icon: Icon }) => <button key={key} className={`nav-link ${page === key ? "nav-active" : ""}`} onClick={() => { setPage(key); setMobileMenu(false); }}><Icon size={18} />{text}{key === "overview" && active && <span className="nav-pulse" />}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-safety"><div className="safety-icon"><ShieldCheck size={19} /></div><b>You’re in control</b><p>Share your location only when it feels right for you.</p><button onClick={() => setPage("settings")}>Privacy settings <ArrowRight size={13} /></button></div>
      <button className="profile-row" onClick={logout}><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="profile-text"><b>{user.name}</b><span>Personal account</span></span><LogOut size={16} /></button>
    </aside>
    {mobileMenu && <button className="scrim" aria-label="Close menu" onClick={() => setMobileMenu(false)} />}
    <main className="main-area">
      <header className="topbar">
        <button className="icon-button mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={20} /></button>
        <div className="breadcrumb">SafeStride <span>/</span> <b>{selectedNav?.text ?? "Journey details"}</b></div>
        <div className="topbar-right"><span className="secure-indicator"><span /> Private &amp; secure</span><button className="icon-button" aria-label="Notifications"><Bell size={18} /></button><span className="avatar avatar-small">{user.name.slice(0, 1).toUpperCase()}</span></div>
      </header>
      <div className="page-content">
        {notice && <div className="toast success-toast"><CheckCircle2 size={18} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={16} /></button></div>}
        {error && <div className="toast error-toast" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button></div>}
        {page === "overview" && <Overview user={user} active={active} history={history} busy={busy} onStart={startJourney} onAction={runAction} onShare={shareJourney} onLocate={captureLocation} onDemo={(action) => active && void runAction(`/demo/${active.id}/${action}`, "POST", {}, `Demo ${action} simulated.`)} onResetDemo={() => void runAction("/demo/reset", "POST", {}, "Demo session reset.")} contacts={contacts} onPage={setPage} />}
        {page === "safety-platform" && <ExistingSafetyPlatform />}
        {page === "journeys" && <JourneyHistory journeys={history} onOpen={(journey) => navigate(`/journey/${journey.id}`)} />}
        {page === "contacts" && <Contacts contacts={contacts} onRefresh={refresh} onError={setError} />}
        {page === "settings" && <Settings user={user} onUpdate={(value) => setUser(value)} onAction={runAction} active={active} />}
      </div>
    </main>
    <Routes><Route path="/journey/:id" element={<JourneyDetail journeys={history} />} /><Route path="/guardian/:id" element={<GuardianPage />} /><Route path="/share/:token" element={<PublicShare />} /></Routes>
  </div>;
}

function Overview({ user, active, history, busy, onStart, onAction, onShare, onLocate, onDemo, onResetDemo, contacts, onPage }: {
  user: User; active: Journey | null; history: Journey[]; busy: boolean; onPage: (page: string) => void;
  onStart: (event: React.FormEvent<HTMLFormElement>) => void;
  onAction: (path: string, method?: string, body?: unknown, message?: string) => Promise<void>;
  onShare: () => void; onLocate: () => void; onDemo: (action: string) => void; onResetDemo: () => void; contacts: Contact[];
}) {
  const [delay, setDelay] = useState("15");
  const [showForm, setShowForm] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const next = active ? new Date(active.nextCheckInAt) : null;
  const remaining = next ? Math.max(0, Math.ceil((next.getTime() - clock) / 60000)) : null;
  const recent = useMemo(() => history.slice(0, 3), [history]);
  return <div className="dashboard">
    <div className="welcome-row"><div><span className="eyebrow">SUNDAY, OCTOBER 25, 2026</span><h1>Good morning, {user.name.split(" ")[0]} <span>👋</span></h1><p className="muted">Wherever you’re headed, we’re here for the journey.</p></div><span className="weather-chip"><Sparkles size={15} /> A little more peace of mind</span></div>
    {!active ? <section className="start-card">
      <div className="start-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-orbit orbit-three" /><div className="art-pin"><Navigation size={25} fill="currentColor" /></div><span className="art-dot dot-a" /><span className="art-dot dot-b" /></div>
      <div className="start-card-copy"><span className="eyebrow">JOURNEY SAFETY SESSION</span><h2>Your next journey,<br />a little more supported.</h2><p>Set a destination and check-in time. We’ll keep your trusted people in the loop if you need us.</p><button className="button button-primary" onClick={() => setShowForm(!showForm)}><Plus size={17} /> {showForm ? "Close setup" : "Plan a journey"} <ArrowRight size={16} /></button><div className="inline-trust"><ShieldCheck size={15} /> Your location stays yours. Always.</div></div>
    </section> : <section className="active-journey">
      <div className="active-head"><div><span className={`status-pill status-${active.status.toLowerCase()}`}><span />{active.demo ? "DEMO SESSION" : active.status.replaceAll("_", " ")}</span><h2>You’re on your way</h2><p className="muted">We’ll stay with you from here to there.</p></div><div className="journey-id">JOURNEY ID <b>{active.id.slice(-8).toUpperCase()}</b></div></div>
      <div className="route-line"><div className="route-stop"><span className="stop-icon start-stop"><MapPin size={17} /></span><div><small>STARTING FROM</small><b>{active.origin}</b></div></div><div className="route-track"><span /><span /><span /></div><div className="route-stop"><span className="stop-icon end-stop"><MapPin size={17} /></span><div><small>HEADED TO</small><b>{active.destination}</b></div></div></div>
      <div className="journey-stats"><div><Clock3 size={17} /><span><small>EXPECTED ARRIVAL</small><b>{new Date(active.expectedArrival).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b></span></div><div><Activity size={17} /><span><small>NEXT CHECK-IN</small><b>{remaining === 0 ? "Due now" : `${remaining} min`}</b></span></div><div><RouteIcon size={17} /><span><small>TRAVEL MODE</small><b>{active.mode}</b></span></div></div>
      {active.vehicleDetails && <div className="vehicle-note"><span>Ride details</span><b>{active.vehicleDetails}</b></div>}
      <div className="journey-support-row" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "7px 10px", marginBottom: 12, fontSize: 10, color: "#91a2b0" }}><span><Users size={14} /> Trusted people</span><b style={{ color: "#d5dfe6" }}>{active.trustedContacts?.length ? active.trustedContacts.map(({ trustedContact }) => trustedContact.name).join(", ") : "No contacts selected"}</b><span><Bell size={14} /> Alerts</span><b style={{ color: "#d5dfe6" }}>{active.notifications.length ? active.notifications.map(({ status }) => status.toLowerCase()).join(", ") : "None yet"}</b></div>
      <JourneyMap journey={active} />
      <div className="journey-actions">
        <button className="button button-primary" disabled={busy} onClick={() => void onAction(`/journeys/${active.id}/check-in`, "POST", {}, "You checked in. Next reminder rescheduled.")}><Check size={17} /> I’m safe</button>
        <div className="delay-action"><select aria-label="Delay minutes" value={delay} onChange={(event) => setDelay(event.target.value)}><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 hour</option></select><button className="button button-secondary" disabled={busy} onClick={() => void onAction(`/journeys/${active.id}/delay`, "POST", { delayMinutes: Number(delay) }, `ETA updated by ${delay} minutes.`)}><Clock3 size={16} /> Running late</button></div>
        <button className="button button-secondary" onClick={onShare}><ArrowDownLeft size={16} /> Share journey</button>
        {active.locationSharing && <button className="button button-secondary" onClick={onLocate}><MapPin size={16} /> Update location</button>}
        <button className="button button-safe" disabled={busy} onClick={() => { if (window.confirm("Mark this journey as safely completed?")) void onAction(`/journeys/${active.id}/arrive`, "POST", {}, "Journey completed safely. Welcome home."); }}><CheckCircle2 size={16} /> Arrived safely</button>
        <button className="button button-sos" disabled={busy} onClick={() => { if (window.confirm("Send an SOS notification to your trusted contacts? In a demo session, no real notifications are sent.")) void onAction(`/journeys/${active.id}/sos`, "POST", {}, "SOS recorded. If you are in immediate danger, call your local emergency number."); }}><Siren size={16} /> SOS</button>
        <button className="end-link" onClick={() => { if (window.confirm("End this journey without marking arrival?")) void onAction(`/journeys/${active.id}/cancel`, "POST", {}, "Journey ended. No further check-ins are scheduled."); }}>End journey</button>
      </div>
      {active.demo && <div className="demo-panel"><div><Sparkles size={17} /><b>Demo mode</b><span>All activity is simulated. No real contacts are notified.</span></div><button onClick={() => onDemo("due")}>Check-in due</button><button onClick={() => onDemo("escalate")}>Simulate escalation</button><button onClick={() => onDemo("sos")}>Demo SOS</button><button onClick={() => onDemo("arrive")}>Safe arrival</button><button onClick={onResetDemo}>Reset</button></div>}
      <EventTimeline journey={active} />
    </section>}
    {showForm && <section className="panel journey-form-card"><div className="section-heading"><div><span className="eyebrow">LET’S GET YOU THERE</span><h2>Plan your journey</h2></div><button className="icon-button" onClick={() => setShowForm(false)} aria-label="Close form"><X size={18} /></button></div>
      <form className="journey-form" onSubmit={onStart}>
        <label>Starting location<input name="origin" placeholder="e.g. Home, 42 Park Street" maxLength={160} required /></label>
        <label>Destination<input name="destination" placeholder="Where are you headed?" maxLength={160} required /></label>
        <label>Travel mode<select name="mode"><option value="cab/auto">Cab / auto</option><option value="walking">Walking</option><option value="bus/metro">Bus / metro</option></select></label>
        <label>Ride details <span className="optional">(optional)</span><input name="vehicleDetails" placeholder="Vehicle plate or driver details" maxLength={120} /></label>
        <label>Estimated travel time<select name="duration"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1 hour 30 minutes</option><option value="120">2 hours</option></select></label>
        <label>Check-in interval<select name="checkInMinutes"><option value="10">Every 10 minutes</option><option value="15">Every 15 minutes</option><option value="20">Every 20 minutes</option><option value="30">Every 30 minutes</option></select></label>
        <label>Grace period<select name="graceMinutes"><option value="3">3 minutes</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option></select></label>
        <div className="contact-picker"><span>Trusted people <span className="optional">(optional, choose any)</span></span>{contacts.length ? contacts.map((contact) => <label key={contact.id} className="check-label"><input type="checkbox" name="contactIds" value={contact.id} /><span>{contact.name}</span><small>{contact.email}</small></label>) : <p>Add a trusted person in the Trusted people section.</p>}</div>
        <label className="consent-row"><input type="checkbox" name="locationSharing" /><span><b>Share my location during this journey</b><small>Only your latest location is shared. You can continue without GPS.</small></span></label>
        <label className="consent-row demo-consent"><input type="checkbox" name="demo" /><span><b>Demo mode</b><small>Simulate check-ins and escalation for a project demo. No real alerts are sent.</small></span></label>
        <div className="form-footer"><span><ShieldCheck size={15} /> Your journey details stay private.</span><button className="button button-primary" disabled={busy}><Navigation size={16} /> {busy ? "Starting…" : "Start protected journey"} <ArrowRight size={16} /></button></div>
      </form>
    </section>}
    <div className="below-grid"><section className="panel recent-card"><div className="panel-title"><div><span className="eyebrow">YOUR JOURNEYS</span><h3>Recent activity</h3></div><button className="text-link" onClick={() => onPage("journeys")}>See all <ArrowRight size={14} /></button></div>
      {!recent.length ? <div className="empty-state"><Compass size={22} /><span>Your journey history will appear here.</span></div> : recent.map((journey) => <div className="history-row" key={journey.id}><span className="history-icon"><Navigation size={16} /></span><div className="history-route"><b>{journey.origin} <ArrowRight size={13} /> {journey.destination}</b><small>{new Date(journey.startedAt).toLocaleDateString()} · {journey.mode}</small></div><span className={`tiny-status tiny-${journey.status.toLowerCase()}`}>{journey.status.replaceAll("_", " ")}</span></div>)}
    </section><section className="panel gentle-card"><div className="gentle-icon"><LifeBuoy size={19} /></div><span className="eyebrow">A GENTLE REMINDER</span><h3>You’re in the driver’s seat.</h3><p>SafeStride supports you, but it can’t contact emergency services or guarantee continuous tracking. If you’re in immediate danger, call your local emergency number.</p><button onClick={onLocate}>Check location permission <ArrowRight size={14} /></button></section></div>
    <footer className="page-footer"><span>Made for the journey ahead <span className="heart">♥</span></span><span>Location sharing is optional · Demo data is clearly labeled</span></footer>
  </div>;
}

function EventTimeline({ journey }: { journey: Journey }) {
  return <div className="timeline-section"><div className="panel-title"><div><span className="eyebrow">JOURNEY LOG</span><h3>Your safety timeline</h3></div><span className="event-count">{journey.events.length} updates</span></div>
    {!journey.events.length ? <p className="muted small">Journey updates will show here.</p> : journey.events.map((item) => <div className="timeline-event" key={item.id}><span className="timeline-dot" /><div><b>{item.type.replaceAll("_", " ").toLowerCase()}</b><small>{item.details} {item.simulated && <i> · simulated</i>}</small></div><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>)}
  </div>;
}

function JourneyHistory({ journeys, onOpen }: { journeys: Journey[]; onOpen: (journey: Journey) => void }) {
  const [filter, setFilter] = useState("all");
  const shown = journeys.filter((journey) => filter === "all" || journey.status.toLowerCase() === filter);
  return <div className="section-page"><div className="page-title"><span className="eyebrow">YOUR TRAVEL JOURNAL</span><h1>My journeys</h1><p>Every journey, all in one place.</p></div><div className="filter-row"><History size={17} />{["all", "completed", "cancelled", "escalated", "sos"].map((key) => <button key={key} className={filter === key ? "filter-active" : ""} onClick={() => setFilter(key)}>{key === "all" ? "All journeys" : key}</button>)}</div>
    {!shown.length ? <div className="panel empty-panel"><Compass size={30} /><h3>No journeys here yet</h3><p>Your completed and active journeys will appear here.</p></div> : <div className="history-list">{shown.map((journey) => <button className="panel history-card" key={journey.id} onClick={() => onOpen(journey)}><div className="history-card-icon"><Navigation size={18} /></div><div className="history-card-main"><b>{journey.origin} <ArrowRight size={14} /> {journey.destination}</b><small>{new Date(journey.startedAt).toLocaleString()} · {journey.mode} · {journey.checkIns.length} check-ins</small></div><span className={`status-pill status-${journey.status.toLowerCase()}`}>{journey.status.replaceAll("_", " ")}</span><ArrowRight size={16} /></button>)}</div>}</div>;
}

function JourneyDetail({ journeys }: { journeys: Journey[] }) {
  const { id } = useParams();
  const journey = journeys.find((item) => item.id === id);
  if (!journey) return <></>;
  return <div className="detail-overlay"><section className="detail-modal"><Link className="detail-close" to="/"><X size={19} /></Link><span className="eyebrow">JOURNEY DETAIL</span><h2>{journey.origin} <ArrowRight size={17} /> {journey.destination}</h2><p className="muted">{new Date(journey.startedAt).toLocaleString()} · {journey.mode}</p><JourneyMap journey={journey} /><h3>Check-ins &amp; updates</h3>{journey.checkIns.map((check) => <p key={check.id} className="detail-line"><CheckCircle2 size={15} /> {check.kind} — {check.message ?? "Checked in"} <small>{new Date(check.createdAt).toLocaleString()}</small></p>)}<EventTimeline journey={journey} /></section></div>;
}

function Contacts({ contacts, onRefresh, onError }: { contacts: Contact[]; onRefresh: () => Promise<void>; onError: (value: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); onError("");
    try {
      const form = new FormData(event.currentTarget);
      await api("/contacts", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      event.currentTarget.reset(); await onRefresh();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not save contact."); }
    finally { setBusy(false); }
  }
  return <div className="section-page"><div className="page-title"><span className="eyebrow">YOUR SUPPORT CIRCLE</span><h1>Trusted people</h1><p>Choose who can be contacted if you miss a check-in.</p></div><div className="contact-layout"><section className="panel contact-form-panel"><div className="gentle-icon"><Users size={19} /></div><h3>Add someone you trust</h3><p>Contacts are only notified when a safety escalation is needed. In development mode, notifications are simulated.</p><form className="form-stack" onSubmit={submit}><label>Their name<input name="name" placeholder="Name" required maxLength={80} /></label><label>Email address<input type="email" name="email" placeholder="them@example.com" required /></label><label>Phone number <span className="optional">(optional)</span><input name="phone" placeholder="+1 555 0100" maxLength={30} /></label><button className="button button-primary" disabled={busy}><Plus size={16} /> Add trusted person</button></form></section><section className="contact-list"><h3>Your people <span>{contacts.length}</span></h3>{!contacts.length ? <div className="panel empty-panel"><ContactRound size={25} /><p>No trusted people added yet.</p></div> : contacts.map((contact) => <div className="panel contact-card" key={contact.id}><span className="avatar">{contact.name.slice(0, 1).toUpperCase()}</span><div><b>{contact.name}</b><small>{contact.email}{contact.phone ? ` · ${contact.phone}` : ""}</small></div><button className="icon-button danger-icon" aria-label={`Remove ${contact.name}`} onClick={async () => { try { await api(`/contacts/${contact.id}`, { method: "DELETE" }); await onRefresh(); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not remove contact."); } }}><Trash2 size={17} /></button></div>)}</section></div></div>;
}

function Settings({ user, onUpdate, onAction, active }: { user: User; onUpdate: (user: User) => void; onAction: (path: string, method?: string, body?: unknown, message?: string) => Promise<void>; active: Journey | null }) {
  const [name, setName] = useState(user.name);
  const [consent, setConsent] = useState(Boolean(user.locationConsent));
  const [message, setMessage] = useState("");
  return <div className="section-page"><div className="page-title"><span className="eyebrow">YOUR ACCOUNT</span><h1>Settings</h1><p>Make SafeStride work the way you want it to.</p></div><div className="settings-stack"><section className="panel settings-card"><div className="settings-icon"><UserRound size={19} /></div><div className="settings-content"><h3>Profile</h3><p>Update your account details.</p><form className="settings-form" onSubmit={async (event) => { event.preventDefault(); try { const result = await api<{ user: User }>("/users/me", { method: "PATCH", body: JSON.stringify({ name }) }); onUpdate(result.user); setMessage("Profile saved."); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not save."); } }}><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label><label>Email address<input value={user.email} disabled /></label><button className="button button-secondary">Save changes</button></form></div></section><section className="panel settings-card"><div className="settings-icon"><MapPin size={19} /></div><div className="settings-content"><h3>Location privacy</h3><p>Location sharing is off by default. A browser cannot guarantee background GPS if suspended or closed.</p><label className="toggle-row"><span><b>Allow location sharing</b><small>Each journey still asks you to opt in individually.</small></span><input type="checkbox" checked={consent} onChange={async (event) => { const enabled = event.target.checked; setConsent(enabled); try { const result = await api<{ user: User }>("/users/me", { method: "PATCH", body: JSON.stringify({ locationConsent: enabled }) }); onUpdate(result.user); } catch (reason) { setConsent(!enabled); setMessage(reason instanceof Error ? reason.message : "Could not update preference."); } }} /></label>{active && <button className="text-link revoke-link" onClick={() => void onAction(`/journeys/${active.id}/share`, "DELETE", undefined, "Journey share links revoked.")}>Revoke active share links</button>}</div></section><section className="panel settings-card"><div className="settings-icon danger-settings"><Trash2 size={18} /></div><div className="settings-content"><h3>Delete your account</h3><p>All journeys, contacts, and account data will be permanently deleted.</p><button className="button button-danger" onClick={async () => { if (window.confirm("Permanently delete your account and all associated data?")) { try { await api("/users/me", { method: "DELETE" }); window.location.reload(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not delete account."); } } }}>Delete account</button></div></section>{message && <p className="settings-message">{message}</p>}</div></div>;
}

function PublicShare() {
  const { token } = useParams();
  const [data, setData] = useState<{ journey: Journey } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (token) api<{ journey: Journey }>(`/share/${token}`).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Link unavailable.")); }, [token]);
  if (error) return <div className="share-page"><Brand /><div className="panel share-message"><Shield size={30} /><h2>Link unavailable</h2><p>{error}</p><p>Ask the traveler for a fresh link if you still need access.</p></div></div>;
  if (!data) return <div className="loading-screen"><div className="spinner" />Loading shared journey…</div>;
  const journey = data.journey;
  return <div className="share-page"><Brand /><div className="share-banner"><ShieldCheck size={16} /> PRIVATE JOURNEY SHARE · LIMITED ACCESS</div><div className="panel share-card"><span className={`status-pill status-${journey.status.toLowerCase()}`}>{journey.status.replaceAll("_", " ")}</span><h1>A journey is being shared with you</h1><div className="route-line"><div className="route-stop"><MapPin size={17} /><b>{journey.origin}</b></div><ArrowRight size={15} /><div className="route-stop"><MapPin size={17} /><b>{journey.destination}</b></div></div><p>Expected arrival {new Date(journey.expectedArrival).toLocaleString()}</p><JourneyMap journey={journey} /><p className="privacy-note"><Shield size={15} /> This link shows limited journey information and expires automatically. Contact the traveler directly if you need urgent help.</p></div></div>;
}

function GuardianPage() {
  const { id } = useParams();
  const [journey, setJourney] = useState<Journey | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (id) api<{ journey: Journey }>(`/guardian/${id}`).then((result) => setJourney(result.journey))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Journey unavailable."));
  }, [id]);
  return <div className="detail-overlay"><section className="detail-modal">
    <Link className="detail-close" to="/"><X size={19} /></Link><Brand small />
    {error ? <div className="share-message"><Shield size={28} /><h2>Journey unavailable</h2><p>{error}</p></div> : !journey ? <div className="loading-screen"><div className="spinner" />Loading authorized journey…</div> : <>
      <span className="eyebrow">AUTHORIZED GUARDIAN VIEW</span><h2>{journey.origin} <ArrowRight size={16} /> {journey.destination}</h2>
      <span className={`status-pill status-${journey.status.toLowerCase()}`}>{journey.status.replaceAll("_", " ")}</span>
      <p className="muted">Expected arrival {new Date(journey.expectedArrival).toLocaleString()}</p>
      <JourneyMap journey={journey} />
      <EventTimeline journey={journey} />
    </>}
  </section></div>;
}

export default App;
